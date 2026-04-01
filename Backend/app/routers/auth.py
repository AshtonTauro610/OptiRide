from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.db.database import get_db
from app.core.dependencies import get_current_admin, get_current_user, get_current_admin_head
from app.services.auth_service import AuthService
from app.schemas.auth import LoginRequest, AdminCreateUserRequest, LoginResponse, UserResponse, FirebaseLoginRequest, UserRole

router = APIRouter()

@router.post("/admin/create-user", response_model=UserResponse)
def admin_create_user(
    data: AdminCreateUserRequest,
    db: Session = Depends(get_db),
    admin = Depends(get_current_admin_head)
):
    auth_service = AuthService()
    
    admin_id = admin.admin_id
    user = auth_service.create_user(data=data, db=db, admin_id=admin_id, creator_access_level=admin.access_level)

    return UserResponse.model_validate(user)

@router.delete("/admin/delete-user/{user_id}")
def admin_delete_user(
    user_id: str,
    db: Session = Depends(get_db),
    admin = Depends(get_current_admin_head)
):
    auth_service = AuthService()
    auth_service.delete_user(user_id=user_id, db=db)
    return {"detail": f"User: {user_id} deleted successfully"}

@router.post("/login", response_model=LoginResponse)
def login(
    token_data: dict, 
    db: Session = Depends(get_db)
):
    auth_service = AuthService()
    login_response = auth_service.login(token_data=token_data, db=db)
    return login_response

@router.post("/logout")
def logout():
    return {"message": "Logout successful"}

@router.get("/me", response_model=UserResponse)
def get_me(
    current_user = Depends(get_current_user)
):
    return UserResponse.model_validate(current_user)

