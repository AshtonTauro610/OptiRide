from pydantic import BaseModel, EmailStr, Field, field_validator
from typing import Optional
from datetime import datetime
from enum import Enum


class UserRole(str, Enum):
    ADMINISTRATOR = "administrator"
    DRIVER = "driver"

class LoginRequest(BaseModel):
    email : EmailStr
    password : str

class FirebaseLoginRequest(BaseModel):
    credentials : str  # Firebase ID token

class PhoneLoginRequest(BaseModel):
    phone_number : str
    otp : str

class TokenRefreshRequest(BaseModel):
    refresh_token : str

class AdminCreateUserRequest(BaseModel):
    email : EmailStr
    password : str = Field(..., min_length=8)
    phone_number : Optional[str] = None
    role : UserRole
    name : Optional[str] = None
    # Administrator-specific
    department : Optional[str] = None
    access_level : Optional[int] = Field(default=1, ge=1, le=5)
    admin_role : Optional[str] = None
    # Driver-specific
    vehicle_type : Optional[str] = None
    license_plate : Optional[str] = None

    @field_validator('phone_number')
    @classmethod
    def validate_phone_number(cls, v: str | None) -> str | None:
        if v is not None and not v.startswith('+'):
            raise ValueError('Phone number must start with + and country code')
        return v

    model_config = {
        "json_schema_extra": {
            "example": {
                "email": "driver@optiride.com",
                "password": "StrongPassword123!",
                "phone_number": "+1234567890",
                "role": "driver",
                "name": "John Doe",
                "access_level": 1
            }
        }
    }

class ChangePasswordRequest(BaseModel):
    old_password : str
    new_password : str = Field(..., min_length=8)

class PasswordResetRequest(BaseModel):
    email : EmailStr

class PasswordResetConfirmRequest(BaseModel):
    email : EmailStr
    reset_token : str
    new_password : str = Field(..., min_length=8)


class TokenResponse(BaseModel):
    token : str
    token_type : str = "bearer"
    refresh_token : Optional[str] = None
    expires_in : int
    user_id : str
    role : UserRole
    issued_at : datetime

class UserResponse(BaseModel):
    user_id : str
    email : EmailStr
    phone_number : Optional[str] = None
    name : str
    user_type : UserRole
    created_by : Optional[str] = None
    access_level : Optional[int] = None  # Only populated for administrators

    class Config:
        from_attributes = True

class LoginResponse(BaseModel):
    token : TokenResponse
    user : UserResponse

class PhoneVerificationResponse(BaseModel):
    verification_id : str
    expires_in : int = 120
    

