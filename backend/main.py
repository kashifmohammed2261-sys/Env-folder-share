import sqlite3
import secrets
from pathlib import Path
from datetime import datetime, timedelta, timezone
from contextlib import asynccontextmanager
from typing import Literal

import jwt
from jwt.exceptions import InvalidTokenError
from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from pydantic import BaseModel, Field
from cryptography.fernet import Fernet
from pwdlib import PasswordHash


# --------------------------------------------------
# CONFIGURATION
# --------------------------------------------------

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "envshare.db"
KEY_PATH = BASE_DIR / ".secret_key"
JWT_KEY_PATH = BASE_DIR / ".jwt_secret"

password_hasher = PasswordHash.recommended()
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


# --------------------------------------------------
# ENCRYPTION KEY
# --------------------------------------------------

def load_encryption_key():
    if KEY_PATH.exists():
        return KEY_PATH.read_bytes()

    key = Fernet.generate_key()
    KEY_PATH.write_bytes(key)
    return key


cipher = Fernet(load_encryption_key())


def encrypt_value(value: str) -> str:
    return cipher.encrypt(value.encode("utf-8")).decode("utf-8")


def decrypt_value(value: str) -> str:
    return cipher.decrypt(value.encode("utf-8")).decode("utf-8")


# --------------------------------------------------
# JWT SECRET
# --------------------------------------------------

def load_jwt_secret():
    if JWT_KEY_PATH.exists():
        return JWT_KEY_PATH.read_text(encoding="utf-8").strip()

    secret = secrets.token_urlsafe(48)
    JWT_KEY_PATH.write_text(secret, encoding="utf-8")

    try:
        JWT_KEY_PATH.chmod(0o600)
    except OSError:
        pass

    return secret


JWT_SECRET = load_jwt_secret()
JWT_ALGORITHM = "HS256"
TOKEN_EXPIRE_MINUTES = 60


# --------------------------------------------------
# PASSWORD HELPERS
# --------------------------------------------------

def hash_password(password: str) -> str:
    return password_hasher.hash(password)


def verify_password(password: str, stored_hash: str) -> bool:
    return password_hasher.verify(password, stored_hash)


# --------------------------------------------------
# DATABASE
# --------------------------------------------------

def get_db():
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")

    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def init_db():
    connection = sqlite3.connect(DB_PATH)

    try:
        connection.execute("PRAGMA foreign_keys = ON")

        connection.executescript("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'user',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS projects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                owner_id INTEGER NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (owner_id) REFERENCES users(id)
            );

            CREATE TABLE IF NOT EXISTS project_members (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL,
                permission TEXT NOT NULL DEFAULT 'viewer',
                UNIQUE(project_id, user_id),
                FOREIGN KEY (project_id) REFERENCES projects(id)
                    ON DELETE CASCADE,
                FOREIGN KEY (user_id) REFERENCES users(id)
                    ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS environments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(project_id, name),
                FOREIGN KEY (project_id) REFERENCES projects(id)
                    ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS variables (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                environment_id INTEGER NOT NULL,
                key TEXT NOT NULL,
                value TEXT NOT NULL,
                is_sensitive INTEGER NOT NULL DEFAULT 0,
                updated_by INTEGER,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(environment_id, key),
                FOREIGN KEY (environment_id) REFERENCES environments(id)
                    ON DELETE CASCADE,
                FOREIGN KEY (updated_by) REFERENCES users(id)
                    ON DELETE SET NULL
            );

            CREATE TABLE IF NOT EXISTS activity_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL,
                user_id INTEGER,
                action TEXT NOT NULL,
                details TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (project_id) REFERENCES projects(id)
                    ON DELETE CASCADE,
                FOREIGN KEY (user_id) REFERENCES users(id)
                    ON DELETE SET NULL
            );
        """)

        connection.commit()
    finally:
        connection.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


# --------------------------------------------------
# FASTAPI APPLICATION
# --------------------------------------------------

app = FastAPI(
    title="EnvShare API",
    description="Team Environment Variable Manager",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --------------------------------------------------
# REQUEST MODELS
# --------------------------------------------------

class UserCreate(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    email: str = Field(min_length=5, max_length=254)
    password: str = Field(min_length=8, max_length=128)


class ProjectCreate(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    description: str = Field(default="", max_length=500)


class MemberCreate(BaseModel):
    email: str = Field(min_length=5, max_length=254)
    permission: Literal["viewer", "editor"] = "viewer"


# --------------------------------------------------
# TOKEN AND AUTHENTICATION HELPERS
# --------------------------------------------------

def create_access_token(user_id: int) -> str:
    expires_at = datetime.now(timezone.utc) + timedelta(
        minutes=TOKEN_EXPIRE_MINUTES
    )

    payload = {
        "sub": str(user_id),
        "exp": expires_at,
    }

    return jwt.encode(
        payload,
        JWT_SECRET,
        algorithm=JWT_ALGORITHM,
    )


def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: sqlite3.Connection = Depends(get_db),
):
    unauthorized = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired login token. Please log in again.",
        headers={"WWW-Authenticate": "Bearer"},
    )

    try:
        payload = jwt.decode(
            token,
            JWT_SECRET,
            algorithms=[JWT_ALGORITHM],
        )

        subject = payload.get("sub")

        if not subject:
            raise unauthorized

        user_id = int(subject)

    except (InvalidTokenError, ValueError, TypeError):
        raise unauthorized

    user = db.execute(
        """
        SELECT id, name, email, role, created_at
        FROM users
        WHERE id = ?
        """,
        (user_id,),
    ).fetchone()

    if user is None:
        raise unauthorized

    return dict(user)


# --------------------------------------------------
# ACTIVITY LOGGING
# --------------------------------------------------

def log_activity(
    db: sqlite3.Connection,
    project_id: int,
    user_id: int,
    action: str,
    details: str,
):
    db.execute(
        """
        INSERT INTO activity_logs
        (project_id, user_id, action, details)
        VALUES (?, ?, ?, ?)
        """,
        (project_id, user_id, action, details),
    )


# --------------------------------------------------
# HEALTH CHECKS
# --------------------------------------------------

@app.get("/")
def home():
    return {
        "message": "Welcome to EnvShare API",
        "status": "running",
    }


@app.get("/api/health")
def health():
    return {"status": "healthy"}


@app.get("/api/health/database")
def database_health(
    db: sqlite3.Connection = Depends(get_db),
):
    db.execute("SELECT 1").fetchone()
    return {"database": "connected"}


# --------------------------------------------------
# USER REGISTRATION
# --------------------------------------------------

@app.post("/api/auth/register", status_code=201)
def register(
    data: UserCreate,
    db: sqlite3.Connection = Depends(get_db),
):
    name = data.name.strip()
    email = data.email.strip().lower()

    if len(name) < 2:
        raise HTTPException(
            status_code=422,
            detail="Name must contain at least two characters.",
        )

    if "@" not in email or "." not in email.rsplit("@", 1)[-1]:
        raise HTTPException(
            status_code=422,
            detail="Please enter a valid email address.",
        )

    existing_user = db.execute(
        "SELECT id FROM users WHERE email = ?",
        (email,),
    ).fetchone()

    if existing_user:
        raise HTTPException(
            status_code=409,
            detail="An account with this email already exists.",
        )

    hashed = hash_password(data.password)

    try:
        cursor = db.execute(
            """
            INSERT INTO users (name, email, password_hash)
            VALUES (?, ?, ?)
            """,
            (name, email, hashed),
        )

        user_id = cursor.lastrowid

    except sqlite3.IntegrityError:
        raise HTTPException(
            status_code=409,
            detail="An account with this email already exists.",
        )

    return {
        "message": "Account created successfully. Please log in.",
        "user": {
            "id": user_id,
            "name": name,
            "email": email,
            "role": "user",
        },
    }


# --------------------------------------------------
# USER LOGIN
# --------------------------------------------------

@app.post("/api/auth/login")
def login(
    form: OAuth2PasswordRequestForm = Depends(),
    db: sqlite3.Connection = Depends(get_db),
):
    email = form.username.strip().lower()

    user = db.execute(
        "SELECT * FROM users WHERE email = ?",
        (email,),
    ).fetchone()

    if user is None or not verify_password(
        form.password,
        user["password_hash"],
    ):
        raise HTTPException(
            status_code=401,
            detail="Incorrect email or password.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = create_access_token(user["id"])

    return {
        "access_token": token,
        "token_type": "bearer",
        "expires_in_minutes": TOKEN_EXPIRE_MINUTES,
        "user": {
            "id": user["id"],
            "name": user["name"],
            "email": user["email"],
            "role": user["role"],
        },
    }


# --------------------------------------------------
# CURRENT USER PROFILE
# --------------------------------------------------

@app.get("/api/auth/me")
def my_profile(
    user: dict = Depends(get_current_user),
):
    return {"user": user}


# --------------------------------------------------
# CREATE PROJECT
# --------------------------------------------------

@app.post("/api/projects", status_code=201)
def create_project(
    data: ProjectCreate,
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    name = data.name.strip()

    if len(name) < 2:
        raise HTTPException(
            status_code=422,
            detail="Project name must contain at least two characters.",
        )

    cursor = db.execute(
        """
        INSERT INTO projects (name, description, owner_id)
        VALUES (?, ?, ?)
        """,
        (name, data.description.strip(), user["id"]),
    )

    project_id = cursor.lastrowid

    log_activity(
        db,
        project_id,
        user["id"],
        "project_created",
        f"Project '{name}' was created.",
    )

    project = db.execute(
        "SELECT * FROM projects WHERE id = ?",
        (project_id,),
    ).fetchone()

    return {
        "message": "Project created successfully.",
        "project": dict(project),
        "permission": "owner",
    }


# --------------------------------------------------
# LIST PROJECTS FOR CURRENT USER
# --------------------------------------------------

@app.get("/api/projects")
def list_projects(
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    projects = db.execute(
        """
        SELECT DISTINCT
            p.*,
            CASE
                WHEN p.owner_id = ? THEN 'owner'
                ELSE pm.permission
            END AS current_permission
        FROM projects p
        LEFT JOIN project_members pm
            ON pm.project_id = p.id
            AND pm.user_id = ?
        WHERE p.owner_id = ? OR pm.user_id = ?
        ORDER BY p.id DESC
        """,
        (user["id"], user["id"], user["id"], user["id"]),
    ).fetchall()

    return {
        "count": len(projects),
        "projects": [dict(project) for project in projects],
    }


# --------------------------------------------------
# PROJECT ACCESS CHECK
# --------------------------------------------------

def get_project_permission(
    db: sqlite3.Connection,
    project_id: int,
    user_id: int,
):
    project = db.execute(
        "SELECT * FROM projects WHERE id = ?",
        (project_id,),
    ).fetchone()

    if project is None:
        raise HTTPException(
            status_code=404,
            detail="Project not found.",
        )

    if project["owner_id"] == user_id:
        return dict(project), "owner"

    membership = db.execute(
        """
        SELECT permission
        FROM project_members
        WHERE project_id = ? AND user_id = ?
        """,
        (project_id, user_id),
    ).fetchone()

    if membership is None:
        raise HTTPException(
            status_code=403,
            detail="You do not have access to this project.",
        )

    return dict(project), membership["permission"]


# --------------------------------------------------
# VIEW PROJECT DETAILS
# --------------------------------------------------

@app.get("/api/projects/{project_id}")
def get_project(
    project_id: int,
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    project, permission = get_project_permission(
        db,
        project_id,
        user["id"],
    )

    members = db.execute(
        """
        SELECT u.id, u.name, u.email, pm.permission
        FROM project_members pm
        JOIN users u ON u.id = pm.user_id
        WHERE pm.project_id = ?
        ORDER BY u.name
        """,
        (project_id,),
    ).fetchall()

    owner = db.execute(
        "SELECT id, name, email FROM users WHERE id = ?",
        (project["owner_id"],),
    ).fetchone()

    return {
        "project": project,
        "owner": dict(owner) if owner else None,
        "current_permission": permission,
        "members": [dict(member) for member in members],
    }


# --------------------------------------------------
# ADD A REGISTERED TEAM MEMBER
# --------------------------------------------------

@app.post("/api/projects/{project_id}/members", status_code=201)
def add_project_member(
    project_id: int,
    data: MemberCreate,
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    project, permission = get_project_permission(
        db,
        project_id,
        user["id"],
    )

    if permission != "owner":
        raise HTTPException(
            status_code=403,
            detail="Only the project owner can manage team membership.",
        )

    email = data.email.strip().lower()

    member = db.execute(
        "SELECT id, name, email FROM users WHERE email = ?",
        (email,),
    ).fetchone()

    if member is None:
        raise HTTPException(
            status_code=404,
            detail="No registered user found with this email.",
        )

    if member["id"] == user["id"]:
        raise HTTPException(
            status_code=400,
            detail="You are already the project owner.",
        )

    db.execute(
        """
        INSERT INTO project_members
            (project_id, user_id, permission)
        VALUES (?, ?, ?)
        ON CONFLICT(project_id, user_id)
        DO UPDATE SET permission = excluded.permission
        """,
        (project_id, member["id"], data.permission),
    )

    log_activity(
        db,
        project_id,
        user["id"],
        "member_permission_updated",
        f"Team access for {email} set to {data.permission}.",
    )

    return {
        "message": "Team access saved successfully.",
        "member": {
            "id": member["id"],
            "name": member["name"],
            "email": member["email"],
            "permission": data.permission,
        },
    }

# --------------------------------------------------
# ENVIRONMENT AND VARIABLE MANAGEMENT
# --------------------------------------------------

class EnvironmentCreate(BaseModel):
    name: str = Field(min_length=2, max_length=40)


class VariableCreate(BaseModel):
    key: str = Field(min_length=1, max_length=200)
    value: str
    is_sensitive: bool = False


class VariableUpdate(BaseModel):
    key: str | None = None
    value: str | None = None
    is_sensitive: bool | None = None


def get_environment_context(db, environment_id: int, user_id: int):
    environment = db.execute(
        "SELECT * FROM environments WHERE id = ?",
        (environment_id,),
    ).fetchone()

    if environment is None:
        raise HTTPException(
            status_code=404,
            detail="Environment not found.",
        )

    project, permission = get_project_permission(
        db,
        environment["project_id"],
        user_id,
    )

    return dict(environment), project, permission


def require_editor(permission: str):
    if permission not in ("owner", "editor"):
        raise HTTPException(
            status_code=403,
            detail="You need owner or editor permission to make changes.",
        )


def validate_variable_key(key: str):
    import re

    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key):
        raise HTTPException(
            status_code=422,
            detail="Invalid variable key. Use letters, numbers and underscores; the key cannot start with a number.",
        )


# --------------------------------------------------
# CREATE ENVIRONMENT
# --------------------------------------------------

@app.post("/api/projects/{project_id}/environments", status_code=201)
def create_environment(
    project_id: int,
    data: EnvironmentCreate,
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    project, permission = get_project_permission(
        db,
        project_id,
        user["id"],
    )

    require_editor(permission)

    name = data.name.strip()

    if len(name) < 2:
        raise HTTPException(
            status_code=422,
            detail="Environment name must contain at least two characters.",
        )

    existing = db.execute(
        """
        SELECT id FROM environments
        WHERE project_id = ? AND LOWER(name) = LOWER(?)
        """,
        (project_id, name),
    ).fetchone()

    if existing:
        raise HTTPException(
            status_code=409,
            detail="This environment already exists in the project.",
        )

    cursor = db.execute(
        """
        INSERT INTO environments (project_id, name)
        VALUES (?, ?)
        """,
        (project_id, name),
    )

    environment_id = cursor.lastrowid

    log_activity(
        db,
        project_id,
        user["id"],
        "environment_created",
        f"Environment '{name}' was created.",
    )

    environment = db.execute(
        "SELECT * FROM environments WHERE id = ?",
        (environment_id,),
    ).fetchone()

    return {
        "message": "Environment created successfully.",
        "environment": dict(environment),
    }


# --------------------------------------------------
# LIST PROJECT ENVIRONMENTS
# --------------------------------------------------

@app.get("/api/projects/{project_id}/environments")
def list_environments(
    project_id: int,
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    get_project_permission(db, project_id, user["id"])

    environments = db.execute(
        """
        SELECT * FROM environments
        WHERE project_id = ?
        ORDER BY id
        """,
        (project_id,),
    ).fetchall()

    return {
        "count": len(environments),
        "environments": [dict(item) for item in environments],
    }


# --------------------------------------------------
# CREATE VARIABLE
# --------------------------------------------------

@app.post("/api/environments/{environment_id}/variables", status_code=201)
def create_variable(
    environment_id: int,
    data: VariableCreate,
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    environment, project, permission = get_environment_context(
        db,
        environment_id,
        user["id"],
    )

    require_editor(permission)

    key = data.key.strip()
    validate_variable_key(key)

    existing = db.execute(
        """
        SELECT id FROM variables
        WHERE environment_id = ? AND key = ?
        """,
        (environment_id, key),
    ).fetchone()

    if existing:
        raise HTTPException(
            status_code=409,
            detail="This variable key already exists in the environment.",
        )

    stored_value = (
        encrypt_value(data.value)
        if data.is_sensitive
        else data.value
    )

    cursor = db.execute(
        """
        INSERT INTO variables
            (environment_id, key, value, is_sensitive, updated_by)
        VALUES (?, ?, ?, ?, ?)
        """,
        (
            environment_id,
            key,
            stored_value,
            int(data.is_sensitive),
            user["id"],
        ),
    )

    variable_id = cursor.lastrowid

    log_activity(
        db,
        project["id"],
        user["id"],
        "variable_created",
        f"Variable '{key}' was created; sensitive={data.is_sensitive}.",
    )

    displayed_value = "••••••••" if data.is_sensitive else data.value

    return {
        "message": "Variable created successfully.",
        "variable": {
            "id": variable_id,
            "environment_id": environment_id,
            "key": key,
            "value": displayed_value,
            "is_sensitive": data.is_sensitive,
        },
    }


# --------------------------------------------------
# LIST VARIABLES
# --------------------------------------------------

@app.get("/api/environments/{environment_id}/variables")
def list_variables(
    environment_id: int,
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    get_environment_context(
        db,
        environment_id,
        user["id"],
    )

    rows = db.execute(
        """
        SELECT id, environment_id, key, value,
               is_sensitive, updated_by, updated_at
        FROM variables
        WHERE environment_id = ?
        ORDER BY key
        """,
        (environment_id,),
    ).fetchall()

    result = []

    for row in rows:
        item = dict(row)
        item["is_sensitive"] = bool(item["is_sensitive"])

        if item["is_sensitive"]:
            item["value"] = "••••••••"

        result.append(item)

    return {
        "count": len(result),
        "variables": result,
    }


# --------------------------------------------------
# UPDATE VARIABLE
# --------------------------------------------------

@app.put(
    "/api/environments/{environment_id}/variables/{variable_id}"
)
def update_variable(
    environment_id: int,
    variable_id: int,
    data: VariableUpdate,
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    environment, project, permission = get_environment_context(
        db,
        environment_id,
        user["id"],
    )

    require_editor(permission)

    existing = db.execute(
        """
        SELECT * FROM variables
        WHERE id = ? AND environment_id = ?
        """,
        (variable_id, environment_id),
    ).fetchone()

    if existing is None:
        raise HTTPException(
            status_code=404,
            detail="Variable not found in this environment.",
        )

    if (
        data.key is None
        and data.value is None
        and data.is_sensitive is None
    ):
        raise HTTPException(
            status_code=422,
            detail="Provide at least one field to update.",
        )

    new_key = (
        data.key.strip()
        if data.key is not None
        else existing["key"]
    )

    validate_variable_key(new_key)

    duplicate = db.execute(
        """
        SELECT id FROM variables
        WHERE environment_id = ? AND key = ? AND id != ?
        """,
        (environment_id, new_key, variable_id),
    ).fetchone()

    if duplicate:
        raise HTTPException(
            status_code=409,
            detail="Another variable already uses this key.",
        )

    was_sensitive = bool(existing["is_sensitive"])

    if was_sensitive:
        old_plain_value = decrypt_value(existing["value"])
    else:
        old_plain_value = existing["value"]

    new_plain_value = (
        data.value
        if data.value is not None
        else old_plain_value
    )

    new_sensitive = (
        data.is_sensitive
        if data.is_sensitive is not None
        else was_sensitive
    )

    stored_value = (
        encrypt_value(new_plain_value)
        if new_sensitive
        else new_plain_value
    )

    db.execute(
        """
        UPDATE variables
        SET key = ?,
            value = ?,
            is_sensitive = ?,
            updated_by = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND environment_id = ?
        """,
        (
            new_key,
            stored_value,
            int(new_sensitive),
            user["id"],
            variable_id,
            environment_id,
        ),
    )

    log_activity(
        db,
        project["id"],
        user["id"],
        "variable_updated",
        f"Variable '{existing['key']}' updated; sensitive={new_sensitive}.",
    )

    displayed_value = (
        "••••••••" if new_sensitive else new_plain_value
    )

    return {
        "message": "Variable updated successfully.",
        "variable": {
            "id": variable_id,
            "environment_id": environment_id,
            "key": new_key,
            "value": displayed_value,
            "is_sensitive": new_sensitive,
        },
    }


# --------------------------------------------------
# DELETE VARIABLE
# --------------------------------------------------

@app.delete(
    "/api/environments/{environment_id}/variables/{variable_id}"
)
def delete_variable(
    environment_id: int,
    variable_id: int,
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    environment, project, permission = get_environment_context(
        db,
        environment_id,
        user["id"],
    )

    require_editor(permission)

    existing = db.execute(
        """
        SELECT id, key FROM variables
        WHERE id = ? AND environment_id = ?
        """,
        (variable_id, environment_id),
    ).fetchone()

    if existing is None:
        raise HTTPException(
            status_code=404,
            detail="Variable not found in this environment.",
        )

    db.execute(
        """
        DELETE FROM variables
        WHERE id = ? AND environment_id = ?
        """,
        (variable_id, environment_id),
    )

    log_activity(
        db,
        project["id"],
        user["id"],
        "variable_deleted",
        f"Variable '{existing['key']}' was deleted.",
    )

    return {"message": "Variable deleted successfully."}


# --------------------------------------------------
# SMART ENV IMPORT PREVIEW
# --------------------------------------------------

from pydantic import BaseModel
from fastapi import HTTPException


class EnvImportPreviewRequest(BaseModel):
    content: str


@app.post("/api/environments/{environment_id}/import-preview")
def preview_env_import(
    environment_id: int,
    data: EnvImportPreviewRequest,
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    get_environment_context(db, environment_id, user["id"])

    existing_rows = db.execute(
        """
        SELECT key, value, is_sensitive
        FROM variables
        WHERE environment_id = ?
        """,
        (environment_id,),
    ).fetchall()

    existing = {}
    for row in existing_rows:
        if row["is_sensitive"]:
            existing[row["key"]] = decrypt_value(row["value"])
        else:
            existing[row["key"]] = row["value"]

    new_items = []
    update_items = []
    unchanged_items = []
    errors = []

    parsed = {}

    for line_number, raw_line in enumerate(data.content.splitlines(), start=1):
        line = raw_line.strip()

        if not line or line.startswith("#"):
            continue

        if "=" not in line:
            errors.append({
                "line": line_number,
                "message": "Expected KEY=VALUE format",
            })
            continue

        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()

        if not key or not key.replace("_", "").isalnum():
            errors.append({
                "line": line_number,
                "message": "Invalid variable key",
            })
            continue

        if key in parsed:
            errors.append({
                "line": line_number,
                "message": "Duplicate key in pasted content",
            })
            continue

        parsed[key] = value

    for key, value in parsed.items():
        if key not in existing:
            new_items.append({"key": key, "value": value})
        elif existing[key] == value:
            unchanged_items.append({"key": key})
        else:
            update_items.append({
                "key": key,
                "old_value": existing[key],
                "new_value": value,
            })

    return {
        "environment_id": environment_id,
        "new": new_items,
        "updates": update_items,
        "unchanged": unchanged_items,
        "errors": errors,
        "summary": {
            "new": len(new_items),
            "updates": len(update_items),
            "unchanged": len(unchanged_items),
            "errors": len(errors),
        },
        "preview_only": True,
    }


# --------------------------------------------------

# --------------------------------------------------
# PROJECT CHANGE HISTORY
# --------------------------------------------------

@app.get("/api/projects/{project_id}/history")
def get_project_history(
    project_id: int,
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    project, permission = get_project_permission(
        db,
        project_id,
        user["id"],
    )

    rows = db.execute(
        """
        SELECT
            activity_logs.id,
            activity_logs.project_id,
            activity_logs.user_id,
            users.email AS changed_by,
            activity_logs.action,
            activity_logs.details,
            activity_logs.created_at
        FROM activity_logs
        LEFT JOIN users ON users.id = activity_logs.user_id
        WHERE activity_logs.project_id = ?
        ORDER BY activity_logs.id DESC
        """,
        (project_id,),
    ).fetchall()

    return {
        "project_id": project_id,
        "project_name": project["name"],
        "count": len(rows),
        "history": [dict(row) for row in rows],
    }

# ==================================================
# ENVS HARE ADMIN PANEL - BACKEND
# ==================================================

class AdminRoleUpdate(BaseModel):
    role: Literal["user", "admin"]


def require_admin_role(user: dict):
    if user.get("role") != "admin":
        raise HTTPException(
            status_code=403,
            detail="Administrator access required.",
        )


# --------------------------------------------------
# ADMIN DASHBOARD OVERVIEW
# --------------------------------------------------

@app.get("/api/admin/overview")
def admin_overview(
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    require_admin_role(user)

    def count_rows(sql: str) -> int:
        return int(db.execute(sql).fetchone()[0])

    return {
        "users": count_rows("SELECT COUNT(*) FROM users"),
        "admins": count_rows(
            "SELECT COUNT(*) FROM users WHERE role = 'admin'"
        ),
        "projects": count_rows("SELECT COUNT(*) FROM projects"),
        "environments": count_rows("SELECT COUNT(*) FROM environments"),
        "variables": count_rows("SELECT COUNT(*) FROM variables"),
        "activity_events": count_rows(
            "SELECT COUNT(*) FROM activity_logs"
        ),
    }


# --------------------------------------------------
# LIST ALL REGISTERED USERS
# --------------------------------------------------

@app.get("/api/admin/users")
def admin_list_users(
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    require_admin_role(user)

    rows = db.execute(
        """
        SELECT id, name, email, role, created_at
        FROM users
        ORDER BY id DESC
        """
    ).fetchall()

    return {
        "count": len(rows),
        "users": [dict(row) for row in rows],
    }


# --------------------------------------------------
# UPDATE USER ROLE
# --------------------------------------------------

@app.patch("/api/admin/users/{target_user_id}/role")
def admin_update_user_role(
    target_user_id: int,
    data: AdminRoleUpdate,
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    require_admin_role(user)

    if target_user_id == user["id"] and data.role != "admin":
        raise HTTPException(
            status_code=400,
            detail="You cannot remove your own admin role.",
        )

    target = db.execute(
        """
        SELECT id, name, email, role
        FROM users
        WHERE id = ?
        """,
        (target_user_id,),
    ).fetchone()

    if target is None:
        raise HTTPException(
            status_code=404,
            detail="User not found.",
        )

    db.execute(
        "UPDATE users SET role = ? WHERE id = ?",
        (data.role, target_user_id),
    )

    return {
        "message": "User role updated successfully.",
        "user": {
            "id": target["id"],
            "name": target["name"],
            "email": target["email"],
            "role": data.role,
        },
    }


# --------------------------------------------------
# LIST ALL PROJECTS
# --------------------------------------------------

@app.get("/api/admin/projects")
def admin_list_projects(
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    require_admin_role(user)

    rows = db.execute(
        """
        SELECT
            p.id,
            p.name,
            p.description,
            p.created_at,
            u.email AS owner_email,

            (
                SELECT COUNT(*)
                FROM environments e
                WHERE e.project_id = p.id
            ) AS environment_count,

            (
                SELECT COUNT(*)
                FROM variables v
                JOIN environments e ON e.id = v.environment_id
                WHERE e.project_id = p.id
            ) AS variable_count

        FROM projects p
        JOIN users u ON u.id = p.owner_id
        ORDER BY p.id DESC
        """
    ).fetchall()

    return {
        "count": len(rows),
        "projects": [dict(row) for row in rows],
    }
