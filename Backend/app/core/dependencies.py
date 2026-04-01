from fastapi import Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.db.database import get_db
from app.core.security import get_firebase_user
from app.models.user import User, Administrator
from app.models.driver import Driver

def get_current_user(
        firebase_user=Depends(get_firebase_user),
        db: Session = Depends(get_db)
) -> User:
    
    uid = firebase_user.get('uid')
    user = db.query(User).filter(User.user_id == uid).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    return user

def get_current_admin(
        current_user: User = Depends(get_current_user),
        db: Session = Depends(get_db)
) -> Administrator:
    
    if current_user.user_type != 'administrator':
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not enough permissions"
        )

    admin = db.query(Administrator).filter(Administrator.user_id == current_user.user_id).first()
    if not admin:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Administrator profile not found"
        )
    return admin

def get_current_driver(
        current_user: User = Depends(get_current_user),
        db: Session = Depends(get_db)
) -> Driver:
    
    if current_user.user_type != 'driver':
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not enough permissions"
        )

    driver = db.query(Driver).filter(Driver.user_id == current_user.user_id).first()
    if not driver:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Driver profile not found"
        )
    return driver

def get_current_admin_head(
        current_user: User = Depends(get_current_user),
        db: Session = Depends(get_db)
) -> Administrator:
    if current_user.user_type != 'administrator':
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not enough permissions - admin access required"
        )

    admin = db.query(Administrator).filter(Administrator.user_id == current_user.user_id).first()
    if not admin:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Administrator profile not found"
        )
    
    if admin.access_level < 3:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not enough permissions - senior admin head access required"
        )
    
    return admin