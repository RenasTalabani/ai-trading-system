"""Ensures `app.*` imports resolve when pytest is run from the ai-service root."""
import sys
import os

sys.path.insert(0, os.path.dirname(__file__))
