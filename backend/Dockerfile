# backend/Dockerfile
# ----------------------
# Frontend build stage
# ----------------------
FROM node:20-alpine AS frontend-build
WORKDIR /app
COPY frontend/package*.json ./ 
RUN npm ci --silent
COPY frontend/ ./
RUN npm run build

# ----------------------
# Backend (final) stage
# ----------------------
FROM python:3.11-slim
WORKDIR /app

# system deps for some python packages (if needed); small and safe
# RUN apt-get update && apt-get install -y --no-install-recommends \
#     build-essential \
#     && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt gunicorn

# Copy backend code
COPY backend/ /app

# Copy frontend build into Flask static folder (backend expects dist in ../frontend/dist)
# We place dist into ./static so Flask serves it (your app.py uses ../frontend/dist)
# Adjust path expected by your app if needed — here we put dist at /app/static
COPY --from=frontend-build /app/dist ./static

# Expose port
EXPOSE 5000

# Use gunicorn for production
CMD ["gunicorn", "-b", "0.0.0.0:5000", "app:app", "--workers", "2", "--threads", "2"]
