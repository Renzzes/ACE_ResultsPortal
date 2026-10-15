#!/bin/bash
set -e
pnpm install --frozen-lockfile
# Database schema is applied manually via docs/migration/sql/001_create_database_and_schema.sql
# Do not run CREATE DATABASE or drizzle-kit push from this hook.
