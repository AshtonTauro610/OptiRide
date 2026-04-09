import pytest
from unittest.mock import MagicMock, patch
from fastapi import HTTPException
from app.services.auth_service import AuthService
from app.schemas.auth import AdminCreateUserRequest, UserRole
from app.models.user import User, Administrator
from app.models.driver import Driver
from datetime import datetime

class TestAuthService:
    @patch("app.services.auth_service.create_firebase_user")
    def test_create_user_admin_role(self, mock_create_fb):
        mock_create_fb.return_value = "fb-admin-id"
        mock_db = MagicMock()
        
        req = AdminCreateUserRequest(
            email="admin@test.com",
            password="StrongPassword123!",
            phone_number="+12345678901",
            name="Admin Tester",
            role=UserRole.ADMINISTRATOR,
            access_level=3
        )
        
        response = AuthService.create_user(mock_db, req, "creator-id")
        
        assert mock_db.add.call_count == 2
        added_objects = [call[0][0] for call in mock_db.add.call_args_list]
        user_obj, profile_obj = added_objects[0], added_objects[1]
        
        assert isinstance(user_obj, User)
        assert user_obj.user_id == "fb-admin-id"
        assert isinstance(profile_obj, Administrator)
        assert profile_obj.access_level == 3
        assert response.email == "admin@test.com"

    @patch("app.services.auth_service.create_firebase_user")
    def test_create_user_driver_role(self, mock_create_fb):
        mock_create_fb.return_value = "fb-driver-id"
        mock_db = MagicMock()
        
        req = AdminCreateUserRequest(
            email="driver@test.com",
            password="StrongPassword123!",
            phone_number="+12345678901",
            name="Driver Tester",
            role=UserRole.DRIVER,
            vehicle_type="Sedan",
            license_plate="XYZ-123"
        )
        
        response = AuthService.create_user(mock_db, req, "creator-id")
        
        added_objects = [call[0][0] for call in mock_db.add.call_args_list]
        profile_obj = added_objects[1]
        
        assert isinstance(profile_obj, Driver)
        assert profile_obj.vehicle_type == "Sedan"

    @patch("app.services.auth_service.verify_firebase_token_string")
    def test_login_valid(self, mock_fb_verify):
        mock_fb_verify.return_value = {"uid": "valid-fb-id"}
        mock_db = MagicMock()
        mock_db.query.return_value.filter.return_value.first.side_effect = [
            User(user_id="valid-fb-id", email="valid@test.com", user_type="driver", name="driver", phone_number="+12345678901")
        ]
        
        token_data = {"credentials": "valid.jwt.token"}
        response = AuthService.login(mock_db, token_data)
        
        assert response.token.token == "valid.jwt.token"
        assert response.user.email == "valid@test.com"

    @patch("app.services.auth_service.verify_firebase_token_string")
    def test_login_invalid_user(self, mock_fb_verify):
        mock_fb_verify.return_value = {"uid": "ghost-id"}
        mock_db = MagicMock()
        mock_db.query.return_value.filter.return_value.first.return_value = None
        
        with pytest.raises(HTTPException) as exc:
            AuthService.login(mock_db, {"credentials": "token"})
        assert exc.value.status_code == 404
        assert exc.value.detail == "User not found"

    def test_get_user_by_id_found(self):
        mock_db = MagicMock()
        mock_user = User(user_id="id123", email="test@test.com")
        mock_db.query.return_value.filter.return_value.first.return_value = mock_user
        
        result = AuthService.get_user_by_id(mock_db, "id123")
        assert result.email == "test@test.com"

    def test_get_user_by_id_not_found(self):
        mock_db = MagicMock()
        mock_db.query.return_value.filter.return_value.first.return_value = None
        
        with pytest.raises(HTTPException) as exc:
            AuthService.get_user_by_id(mock_db, "id123")
        assert exc.value.status_code == 404

    @patch("app.services.auth_service.delete_firebase_user")
    def test_delete_user(self, mock_delete_fb):
        mock_db = MagicMock()
        mock_user = User(user_id="id123")
        mock_db.query.return_value.filter.return_value.first.return_value = mock_user
        
        AuthService.delete_user(mock_db, "id123")
        
        mock_delete_fb.assert_called_once_with("id123")
        mock_db.delete.assert_called_once_with(mock_user)
        mock_db.commit.assert_called_once()

    @patch("app.services.auth_service.update_firebase_user")
    def test_update_user(self, mock_update_fb):
        mock_db = MagicMock()
        mock_user = User(user_id="id123", email="old@test.com", phone_number="old", user_type="driver", name="tester")
        mock_db.query.return_value.filter.return_value.first.return_value = mock_user
        
        result = AuthService.update_user(mock_db, "id123", email="new@test.com")
        
        mock_update_fb.assert_called_once_with(uid="id123", email="new@test.com", password=None, phone_number=None)
        assert result.email == "new@test.com"
        assert result.phone_number == "old" # Should remain untouched
        mock_db.commit.assert_called_once()
