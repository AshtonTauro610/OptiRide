import pytest
from unittest.mock import patch
from app.models.user import User

@pytest.fixture
def mock_firebase():
    with patch("app.services.auth_service.verify_firebase_token_string") as mock_verify, \
         patch("app.services.auth_service.create_firebase_user") as mock_create, \
         patch("app.services.auth_service.delete_firebase_user") as mock_delete, \
         patch("app.services.auth_service.update_firebase_user") as mock_update:
         
        mock_verify.return_value = {"uid": "test-firebase-uid"}
        mock_create.return_value = "new-firebase-uid"
        mock_delete.return_value = None
        mock_update.return_value = None
        yield {
            "verify": mock_verify,
            "create": mock_create,
            "delete": mock_delete,
            "update": mock_update
        }

def test_tc_auth_001_login_valid(client, db_session, mock_firebase):
    # Setup - mock user in db
    test_user = User(
        user_id="test-firebase-uid",
        email="test@optiride.com",
        name="Test User",
        user_type="driver",
        phone_number="+1234567890",
        created_by="admin-1"
    )
    
    # Mocking the query to return the test_user
    mock_query = db_session.query.return_value
    mock_filter = mock_query.filter.return_value
    mock_filter.first.return_value = test_user

    response = client.post("/auth/login", json={"credentials": "valid-mock-token"})
    assert response.status_code == 200
    data = response.json()
    assert "token" in data
    assert data["user"]["email"] == "test@optiride.com"

def test_tc_auth_002_login_invalid_password(client, mock_firebase):
    # Setup - simulate firebase returning invalid token exception
    mock_firebase["verify"].side_effect = ValueError("Token invalid")
    
    # The application naturally propagates this ValueError
    with pytest.raises(ValueError, match="Token invalid"):
        client.post("/auth/login", json={"credentials": "invalid-token"})
    
def test_tc_auth_003_login_empty_fields(client):
    response = client.post("/auth/login", json={})
    assert response.status_code == 400 # The app explicitly returns 400 when 'credentials' is missing

def test_tc_auth_004_driver_registration(client, mock_firebase):
    req_data = {
        "email": "driver1@optiride.com",
        "password": "StrongPassword123!",
        "phone_number": "+1234567890",
        "role": "driver",
        "name": "John Driver",
        "vehicle_type": "Sedan",
        "license_plate": "ABC-1234"
    }
    response = client.post("/auth/admin/create-user", json=req_data)
    assert response.status_code == 200
    data = response.json()
    assert data["email"] == "driver1@optiride.com"
    assert data["user_type"] == "driver"

def test_tc_auth_006_secure_password(client):
    req_data = {
        "email": "driver2@optiride.com",
        "password": "weak",
        "phone_number": "+1234567890",
        "role": "driver",
        "name": "Weak Password Driver"
    }
    response = client.post("/auth/admin/create-user", json=req_data)
    assert response.status_code == 422
    data = response.json()
    assert "detail" in data
    assert any(error["loc"] == ["body", "password"] for error in data["detail"])

def test_tc_auth_007_duplicate_registration(client, mock_firebase):
    req_data = {
        "email": "duplicate@optiride.com",
        "password": "StrongPassword123!",
        "phone_number": "+1234567890",
        "role": "driver",
        "name": "First Driver"
    }
    # Simulate email already exists in Firebase Error
    mock_firebase["create"].side_effect = Exception("EMAIL_EXISTS")
    
    # The error naturally bubbles up from the firebase integration since it's an unhandled provider error
    with pytest.raises(Exception, match="EMAIL_EXISTS"):
        client.post("/auth/admin/create-user", json=req_data)
