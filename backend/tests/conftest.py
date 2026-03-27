"""
Shared fixtures for backend tests.
Uses a separate in-memory SQLite database so tests don't touch finance.db.
"""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from database import Base, get_db
from main import app

# In-memory SQLite for test isolation
TEST_DATABASE_URL = "sqlite:///./test_finance.db"
test_engine = create_engine(TEST_DATABASE_URL, connect_args={"check_same_thread": False})
TestSession = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)


def override_get_db():
    db = TestSession()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(autouse=True)
def setup_db():
    """Create fresh tables before each test, drop after."""
    Base.metadata.create_all(bind=test_engine)
    app.dependency_overrides[get_db] = override_get_db
    yield
    Base.metadata.drop_all(bind=test_engine)
    app.dependency_overrides.clear()


@pytest.fixture
def client():
    """FastAPI test client."""
    return TestClient(app)


@pytest.fixture
def auth_client(client):
    """Returns (client, token, user) after registering a test user."""
    res = client.post("/auth/register", json={
        "email": "test@example.com",
        "password": "testpass123",
        "display_name": "Test User",
    })
    assert res.status_code == 200
    data = res.json()
    token = data["token"]
    user = data["user"]

    class AuthClient:
        def __init__(self):
            self.client = client
            self.token = token
            self.user = user
            self.headers = {"Authorization": f"Bearer {token}"}

        def get(self, url, **kwargs):
            kwargs.setdefault("headers", self.headers)
            return self.client.get(url, **kwargs)

        def post(self, url, **kwargs):
            kwargs.setdefault("headers", self.headers)
            return self.client.post(url, **kwargs)

        def put(self, url, **kwargs):
            kwargs.setdefault("headers", self.headers)
            return self.client.put(url, **kwargs)

        def delete(self, url, **kwargs):
            kwargs.setdefault("headers", self.headers)
            return self.client.delete(url, **kwargs)

    return AuthClient()
