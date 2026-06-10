"""
core/logger.py - ZimaTAG Logging System
Gestion centralisée des logs avec rotation
"""
import logging
import sys
from pathlib import Path
from datetime import datetime
from logging.handlers import RotatingFileHandler

class ZimaLogger:
    """Logger singleton pour ZimaTAG"""
    
    _instance = None
    _initialized = False
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance
    
    def __init__(self):
        if ZimaLogger._initialized:
            return
        
        self.log_dir = Path("/app_data/tagaudit/logs")
        self.log_dir.mkdir(parents=True, exist_ok=True)
        
        self.logger = logging.getLogger("ZimaTAG")
        self.logger.setLevel(logging.DEBUG)
        self.logger.handlers.clear()
        
        # Format
        fmt = logging.Formatter(
            "%(asctime)s | %(levelname)-8s | %(module)s:%(lineno)d | %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S"
        )
        
        # Console handler
        console = logging.StreamHandler(sys.stdout)
        console.setLevel(logging.INFO)
        console.setFormatter(fmt)
        self.logger.addHandler(console)
        
        # File handler avec rotation
        log_file = self.log_dir / f"zimatag_{datetime.now():%Y%m%d}.log"
        file_handler = RotatingFileHandler(
            log_file, maxBytes=10*1024*1024, backupCount=5, encoding='utf-8'
        )
        file_handler.setLevel(logging.DEBUG)
        file_handler.setFormatter(fmt)
        self.logger.addHandler(file_handler)
        
        ZimaLogger._initialized = True
    
    def debug(self, msg: str): self.logger.debug(msg)
    def info(self, msg: str): self.logger.info(msg)
    def warning(self, msg: str): self.logger.warning(msg)
    def error(self, msg: str): self.logger.error(msg)
    def critical(self, msg: str): self.logger.critical(msg)

# Instance globale
logger = ZimaLogger()
