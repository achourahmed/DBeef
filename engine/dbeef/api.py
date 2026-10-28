"""HTTP API the UI talks to (spec §4.3). FastAPI publishes the contract at /openapi.json."""

import secrets
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.utils import get_openapi
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel
from starlette.exceptions import HTTPException as StarletteHTTPException

from .adapters.base import Collection, DBeefError, Description, NotFound, QueryResult
from .project import Project, StoreStatus
from .schema_map import SchemaMap, build_schema_map

TOKEN_HEADER = "X-DBeef-Token"
_STATUS = {"write_blocked": 403, "store_unavailable": 503, "not_found": 404,
           "bad_query": 400, "timeout": 504}


class ErrorDetail(BaseModel):
    code: str
    message: str


class ErrorBody(BaseModel):
    error: ErrorDetail


_ERROR_RESPONSES = {status: {"model": ErrorBody} for status in (400, 401, 403, 404, 500, 503, 504)}


class ProjectInfo(BaseModel):
    name: str


class QueryBody(BaseModel):
    text: str
    limit: int | None = None


def _error(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": {"code": code, "message": message}})


def create_app(projects: dict[str, Project], token: str, allow_origins: list[str]) -> FastAPI:
    app = FastAPI(title="DBeef engine", responses=_ERROR_RESPONSES)
    expected = token.encode()

    @app.middleware("http")
    async def require_token(request: Request, call_next):
        # Preflights and non-API paths (dev page, /openapi.json) carry no data.
        if request.method != "OPTIONS" and request.url.path.startswith("/api/"):
            # Bytes, not str: compare_digest raises on non-ASCII str.
            if not secrets.compare_digest(request.headers.get(TOKEN_HEADER, "").encode(), expected):
                return _error(401, "unauthorized", f"missing or wrong {TOKEN_HEADER} header")
        try:
            return await call_next(request)
        except Exception as e:  # caught here, inside CORS, so even a 500 keeps the fixed body
            return _error(500, "internal", f"{type(e).__name__}: {e}")

    # Added last so it is outermost: 401s still carry CORS headers.
    app.add_middleware(CORSMiddleware, allow_origins=allow_origins, allow_methods=["GET", "POST"],
                       allow_headers=[TOKEN_HEADER, "Content-Type"])

    @app.exception_handler(DBeefError)
    async def dbeef_error(request: Request, exc: DBeefError):
        return _error(_STATUS.get(exc.code, 500), exc.code, exc.message)

    @app.exception_handler(StarletteHTTPException)
    async def http_error(request: Request, exc: StarletteHTTPException):
        code = {404: "not_found", 401: "unauthorized"}.get(exc.status_code, "bad_query")
        return _error(exc.status_code, code, str(exc.detail))

    @app.exception_handler(RequestValidationError)
    async def bad_request(request: Request, exc: RequestValidationError):
        return _error(400, "bad_query", str(exc.errors()))

    def project(p: str) -> Project:
        if p not in projects:
            raise NotFound(f"no project {p!r}")
        return projects[p]

    @app.get("/", include_in_schema=False)
    def dev_page():
        # Throwaway page for checking the engine in a browser; the real UI lives in app/.
        return FileResponse(Path(__file__).parent / "static" / "index.html")

    @app.get("/api/projects", response_model=list[ProjectInfo])
    def list_projects():
        return [ProjectInfo(name=n) for n in projects]

    @app.get("/api/projects/{p}/stores", response_model=list[StoreStatus])
    def stores(p: str):
        return project(p).statuses()

    @app.get("/api/projects/{p}/stores/{s}/collections", response_model=list[Collection])
    def collections(p: str, s: str):
        return project(p).adapter(s).list_collections()

    # Declared before the describe route: {c:path} would otherwise swallow "/rows".
    @app.get("/api/projects/{p}/stores/{s}/collections/{c:path}/rows", response_model=QueryResult)
    def rows(p: str, s: str, c: str, limit: int | None = None):
        return project(p).adapter(s).sample(c, limit)

    @app.get("/api/projects/{p}/stores/{s}/collections/{c:path}", response_model=Description)
    def describe(p: str, s: str, c: str):
        return project(p).adapter(s).describe(c)

    @app.post("/api/projects/{p}/stores/{s}/query", response_model=QueryResult)
    def query(p: str, s: str, body: QueryBody):
        return project(p).adapter(s).query(body.text, body.limit)

    @app.get("/api/projects/{p}/schema-map", response_model=SchemaMap)
    def schema_map(p: str):
        return build_schema_map(project(p))

    def openapi():
        # Validation errors return 400 with ErrorBody (see bad_request), not FastAPI's 422.
        if app.openapi_schema is None:
            schema = get_openapi(title=app.title, version=app.version, routes=app.routes)
            for path in schema["paths"].values():
                for op in path.values():
                    op.get("responses", {}).pop("422", None)
            app.openapi_schema = schema
        return app.openapi_schema

    app.openapi = openapi
    return app
