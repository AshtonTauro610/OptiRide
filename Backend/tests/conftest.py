import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from unittest.mock import MagicMock

from main import app
from app.db.database import Base, get_db
from app.core.dependencies import get_current_admin, get_current_admin_head

@pytest.fixture()
def db_session():
    mock_db = MagicMock()
    # Provide sensible defaults for queries
    mock_query = MagicMock()
    mock_filter = MagicMock()
    mock_first = MagicMock()
    mock_first.return_value = None
    
    mock_db.query.return_value = mock_query
    mock_query.filter.return_value = mock_filter
    mock_filter.first = mock_first
    
    try:
        yield mock_db
    finally:
        pass

@pytest.fixture()
def client(db_session):
    def override_get_db():
        try:
            yield db_session
        finally:
            pass

    def override_get_current_admin_head():
        mock_admin = MagicMock()
        mock_admin.admin_id = "test-admin-head-id"
        mock_admin.access_level = 5
        return mock_admin

    def override_get_current_admin():
        mock_admin = MagicMock()
        mock_admin.admin_id = "test-admin-id"
        mock_admin.access_level = 2
        return mock_admin

    def override_get_current_driver():
        mock_driver = MagicMock()
        mock_driver.driver_id = "test-driver-id"
        mock_driver.user_id = "test-user-id"
        return mock_driver

    from app.core.dependencies import get_current_driver
    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_admin_head] = override_get_current_admin_head
    app.dependency_overrides[get_current_admin] = override_get_current_admin
    app.dependency_overrides[get_current_driver] = override_get_current_driver

    with TestClient(app) as c:
        yield c

    app.dependency_overrides.clear()
