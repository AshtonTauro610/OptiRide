from sqlalchemy.orm import Session
from fastapi import HTTPException, status
from typing import Optional, Tuple
from datetime import datetime
import uuid

from app.models.user import User, Administrator
from app.models.driver import Driver
from app.core.security import (
    verify_firebase_token_string,
    create_firebase_user,
    update_firebase_user,
    delete_firebase_user
)
from app.schemas.auth import (
    AdminCreateUserRequest,
    TokenResponse,
    UserResponse,
    LoginResponse,
    UserRole
)

class AuthService:
    
    @staticmethod
    def create_user(db: Session, data: AdminCreateUserRequest, admin_id: str, creator_access_level: int = 1) -> UserResponse:
        firebase_user = create_firebase_user(
            email=data.email,
            password=data.password,
            phone_number=data.phone_number
        )

        try:
            user = User(
                user_id=firebase_user,
                email=data.email,
                phone_number=data.phone_number,
                name=data.name if data.name else "",
                user_type=data.role.value,
                created_by=admin_id
            )
            db.add(user)
            db.flush()

            if data.role == UserRole.ADMINISTRATOR:
                # Determine role string based on access level if not provided
                default_role = "admin_head" if data.access_level >= 2 else "admin"
                actual_role = data.admin_role if data.admin_role else default_role
                
                profile = Administrator(
                    user_id=user.user_id,
                    admin_id=str(uuid.uuid4()),
                    role=actual_role,
                    department=data.department if data.department else "",
                    access_level=data.access_level if data.access_level else 1
                )
            elif data.role == UserRole.DRIVER:
                profile = Driver(
                    user_id=user.user_id,
                    name=data.name if data.name else "",
                    vehicle_type=data.vehicle_type,
                    license_plate=data.license_plate
                )
            else:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Invalid user role",
                )
            db.add(profile)
            db.commit()
            db.refresh(user)
            db.refresh(profile)

            return UserResponse.model_validate(user)
        except Exception as e:
            db.rollback()
            if 'firebase_user' in locals():
                delete_firebase_user(firebase_user)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Error creating user: {str(e)}",
            )
    
    @staticmethod
    def login(db: Session, token_data: dict) -> LoginResponse:
        # Extract the Firebase ID token from the request body
        token = token_data.get("credentials")
        if not token:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Missing credentials in request body",
            )
        
        data = verify_firebase_token_string(token)
        user_id = data.get("uid")

        user = db.query(User).filter(User.user_id == user_id).first()

        if not user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User not found",
            )
        
        user.last_login = datetime.utcnow()
        db.commit()

        # Create user response
        user_response = UserResponse.model_validate(user)
        
        # If user is an administrator, include access_level
        if user.user_type == "administrator":
            admin = db.query(Administrator).filter(Administrator.user_id == user.user_id).first()
            if admin:
                user_response.access_level = admin.access_level

        return LoginResponse(
            user=user_response,
            token=TokenResponse(
                token=token,
                token_type="bearer",
                expires_in=3600,
                user_id=user.user_id,
                role=user.user_type,
                issued_at=datetime.utcnow()
            )
        )
    
    @staticmethod
    def get_user_by_id(db: Session, user_id: str) -> Optional[User]:
        user = db.query(User).filter(User.user_id == user_id).first()

        if not user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User not found",
            )
        
        return user
    
    @staticmethod
    def delete_user(db: Session, user_id: str) -> None:
        user = db.query(User).filter(User.user_id == user_id).first()
        if not user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User not found",
            )
        
        delete_firebase_user(user.user_id)
        db.delete(user)
        db.commit()

    @staticmethod
    def update_user(db: Session, user_id: str, email: Optional[str] = None, password: Optional[str] = None, phone_number: Optional[str] = None) -> UserResponse:
        user = db.query(User).filter(User.user_id == user_id).first()
        if not user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User not found",
            )
        
        update_firebase_user(
            uid=user.user_id,
            email=email,
            password=password,
            phone_number=phone_number
        )

        if email:
            user.email = email
        if phone_number:
            user.phone_number = phone_number

        db.commit()
        db.refresh(user)

        return UserResponse.model_validate(user)

    