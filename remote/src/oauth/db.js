/**
 * Database setup for the MCP Worker.
 * Connects to the same PostgreSQL database as the main site via Hyperdrive.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { pgTable, varchar, text, timestamp, uniqueIndex, index, } from 'drizzle-orm/pg-core';
// ── Re-define only the tables the MCP worker needs ───────────────────────────
// (Avoids importing the full Astro site schema which has Astro-specific deps)
export const tUsers = pgTable('users', {
    id: varchar('id', { length: 36 }).primaryKey(),
    email: varchar('email', { length: 255 }).notNull(),
});
export const tApiKeys = pgTable('api_keys', {
    id: varchar('id', { length: 36 }).primaryKey(),
    userId: varchar('user_id', { length: 36 }).notNull(),
    keyHash: varchar('key_hash', { length: 64 }).notNull(),
    keyPrefix: varchar('key_prefix', { length: 12 }).notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true, mode: 'date' }),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
}, (table) => ({
    keyHashIdx: uniqueIndex('uq_api_key_hash').on(table.keyHash),
    userIdx: index('idx_api_keys_user').on(table.userId),
}));
export const tOAuthClients = pgTable('oauth_clients', {
    id: varchar('id', { length: 36 }).primaryKey(),
    clientId: varchar('client_id', { length: 64 }).notNull(),
    clientSecretHash: varchar('client_secret_hash', { length: 64 }),
    redirectUris: text('redirect_uris').notNull(),
    clientName: varchar('client_name', { length: 255 }),
    clientUri: text('client_uri'),
    logoUri: text('logo_uri'),
    scope: varchar('scope', { length: 500 }),
    grantTypes: varchar('grant_types', { length: 500 }).notNull(),
    responseTypes: varchar('response_types', { length: 500 }).notNull(),
    tokenEndpointAuthMethod: varchar('token_endpoint_auth_method', { length: 50 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
}, (table) => ({
    clientIdIdx: uniqueIndex('uq_oauth_client_id').on(table.clientId),
}));
export const tOAuthAuthorizationCodes = pgTable('oauth_authorization_codes', {
    id: varchar('id', { length: 36 }).primaryKey(),
    codeHash: varchar('code_hash', { length: 64 }).notNull(),
    clientId: varchar('client_id', { length: 64 }).notNull(),
    userId: varchar('user_id', { length: 36 }).notNull(),
    redirectUri: text('redirect_uri').notNull(),
    scope: varchar('scope', { length: 500 }),
    codeChallenge: varchar('code_challenge', { length: 128 }).notNull(),
    codeChallengeMethod: varchar('code_challenge_method', { length: 10 }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
}, (table) => ({
    codeHashIdx: uniqueIndex('uq_oauth_code_hash').on(table.codeHash),
}));
export const tOAuthAccessTokens = pgTable('oauth_access_tokens', {
    id: varchar('id', { length: 36 }).primaryKey(),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    clientId: varchar('client_id', { length: 64 }).notNull(),
    userId: varchar('user_id', { length: 36 }).notNull(),
    scope: varchar('scope', { length: 500 }),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
}, (table) => ({
    tokenHashIdx: uniqueIndex('uq_oauth_access_token_hash').on(table.tokenHash),
}));
export const tOAuthRefreshTokens = pgTable('oauth_refresh_tokens', {
    id: varchar('id', { length: 36 }).primaryKey(),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    clientId: varchar('client_id', { length: 64 }).notNull(),
    userId: varchar('user_id', { length: 36 }).notNull(),
    accessTokenId: varchar('access_token_id', { length: 36 }),
    scope: varchar('scope', { length: 500 }),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
}, (table) => ({
    tokenHashIdx: uniqueIndex('uq_oauth_refresh_token_hash').on(table.tokenHash),
}));
export const tOAuthMcpKeys = pgTable('oauth_mcp_keys', {
    userId: varchar('user_id', { length: 36 }).primaryKey(),
    apiKeyId: varchar('api_key_id', { length: 36 }).notNull(),
    encryptedApiKey: text('encrypted_api_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
});
// ── DB factory ───────────────────────────────────────────────────────────────
export function createDb(connectionString) {
    // prepare: false required for Hyperdrive connection pooling
    const client = postgres(connectionString, { prepare: false });
    return drizzle(client, {
        schema: {
            tUsers,
            tApiKeys,
            tOAuthClients,
            tOAuthAuthorizationCodes,
            tOAuthAccessTokens,
            tOAuthRefreshTokens,
            tOAuthMcpKeys,
        },
    });
}
