import { describe, expect, it } from "@effect/vitest";
import { EnvironmentId } from "@t3tools/contracts";
import type {
  RelayEnvironmentLinkProofPayload,
  RelayEnvironmentLinkRequest,
  RelayManagedEndpoint,
} from "@t3tools/contracts/relay";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

import * as RelayDb from "../db.ts";
import { relayEnvironmentLinks } from "../persistence/schema.ts";
import * as EnvironmentLinks from "./EnvironmentLinks.ts";

describe("EnvironmentLinks", () => {
  it.effect("lets only explicit links restore a revoked row", () => {
    const conflictUpdates: Array<{
      readonly set: Record<string, unknown>;
      readonly setWhere?: SQL;
    }> = [];
    const returningRows: Array<ReadonlyArray<{ readonly environmentId: string }>> = [
      [],
      [{ environmentId: "env-1" }],
    ];
    const fakeDb = {
      insert: () => ({
        values: () => ({
          onConflictDoUpdate: (update: {
            readonly set: Record<string, unknown>;
            readonly setWhere?: SQL;
          }) => {
            conflictUpdates.push(update);
            return {
              returning: () => Effect.succeed(returningRows.shift() ?? []),
            };
          },
        }),
      }),
    } as unknown as RelayDb.RelayDb["Service"];
    const environmentId = EnvironmentId.make("env-1");
    const endpoint = {
      httpBaseUrl: "https://env-1.example.test",
      wsBaseUrl: "wss://env-1.example.test",
      providerKind: "cloudflare_tunnel",
    } satisfies RelayManagedEndpoint;
    const proof = {
      iss: "t3-env:env-1",
      aud: "https://relay.example.test",
      sub: "env-1",
      jti: "link-proof-1",
      iat: 1_777_000_000,
      exp: 1_777_000_300,
      challenge: "link-challenge",
      descriptor: {
        environmentId,
        label: "Environment 1",
        platform: { os: "linux", arch: "x64" },
        serverVersion: "0.0.0-test",
        capabilities: { repositoryIdentity: false },
      },
      environmentId,
      environmentPublicKey: "public-key",
      endpoint,
      origin: { localHttpHost: "127.0.0.1", localHttpPort: 3773 },
      scopes: ["agent_activity_notifications", "managed_tunnels"],
    } satisfies RelayEnvironmentLinkProofPayload;
    const request = {
      proof: "proof",
      notificationsEnabled: true,
      liveActivitiesEnabled: true,
      managedTunnelsEnabled: true,
    } satisfies RelayEnvironmentLinkRequest;
    const input = { userId: "user-1", request, proof, endpoint } satisfies Parameters<
      EnvironmentLinks.EnvironmentLinks["Service"]["upsert"]
    >[0];

    return Effect.gen(function* () {
      const links = yield* EnvironmentLinks.EnvironmentLinks;
      const resumeError = yield* links.upsert(input).pipe(Effect.flip);
      expect(resumeError).toBeInstanceOf(EnvironmentLinks.EnvironmentLinkRevoked);

      yield* links.upsert({
        ...input,
        request: { ...request, intent: "explicit" },
      });

      const resumeUpdate = conflictUpdates[0];
      expect(resumeUpdate).toHaveProperty("setWhere");
      expect(new PgDialect().sqlToQuery(resumeUpdate!.setWhere!).sql).toContain(
        '"relay_environment_links"."revoked_at" is null',
      );
      expect(conflictUpdates[1]).not.toHaveProperty("setWhere");
      expect(conflictUpdates[1]?.set).toMatchObject({ revokedAt: null });
    }).pipe(
      Effect.provide(
        EnvironmentLinks.layer.pipe(Layer.provide(Layer.succeed(RelayDb.RelayDb, fakeDb))),
      ),
    );
  });

  it.effect("includes cleanup rows only for account management", () => {
    const joins: Array<SQL> = [];
    const conditions: Array<SQL> = [];
    const fakeDb = {
      select: () => ({
        from: () => ({
          leftJoin: (_table: unknown, condition: SQL) => {
            joins.push(condition);
            return {
              where: (where: SQL) => {
                conditions.push(where);
                return Effect.succeed([]);
              },
            };
          },
        }),
      }),
    } as unknown as RelayDb.RelayDb["Service"];

    return Effect.gen(function* () {
      const links = yield* EnvironmentLinks.EnvironmentLinks;
      yield* links.listForUser({ userId: "user-1" });
      yield* links.listForUser({ userId: "user-1", includeCleanupPending: true });

      const dialect = new PgDialect();
      const defaultQuery = dialect.sqlToQuery(conditions[0]!);
      expect(defaultQuery.sql).toContain('"relay_environment_links"."user_id" = $1');
      expect(defaultQuery.sql).toContain('"relay_environment_links"."revoked_at" is null');
      expect(defaultQuery.sql).not.toContain("managed_endpoint_allocations");

      const cleanupQuery = dialect.sqlToQuery(conditions[1]!);
      expect(cleanupQuery.sql).toContain(
        '"relay_managed_endpoint_allocations"."environment_id" is not null',
      );
      expect(cleanupQuery.sql).toContain(" or ");

      const joinQuery = dialect.sqlToQuery(joins[0]!);
      expect(joinQuery.sql).toContain(
        '"relay_managed_endpoint_allocations"."user_id" = "relay_environment_links"."user_id"',
      );
      expect(joinQuery.sql).toContain(
        '"relay_managed_endpoint_allocations"."environment_id" = "relay_environment_links"."environment_id"',
      );
    }).pipe(
      Effect.provide(
        EnvironmentLinks.layer.pipe(Layer.provide(Layer.succeed(RelayDb.RelayDb, fakeDb))),
      ),
    );
  });

  it.effect("retains link lookup failures with user and environment identity", () => {
    const cause = new Error("database unavailable");
    const fakeDb = {
      select: () => ({
        from: (table: unknown) => {
          expect(table).toBe(relayEnvironmentLinks);
          return {
            where: () => ({
              limit: () => Effect.fail(cause),
            }),
          };
        },
      }),
    } as unknown as RelayDb.RelayDb["Service"];

    return Effect.gen(function* () {
      const links = yield* EnvironmentLinks.EnvironmentLinks;
      const error = yield* Effect.flip(
        links.getForUser({ userId: "user-1", environmentId: "env-1" }),
      );

      expect(error).toMatchObject({
        _tag: "EnvironmentLinkLookupPersistenceError",
        userId: "user-1",
        environmentId: "env-1",
      });
      expect(error.cause).toBe(cause);
    }).pipe(
      Effect.provide(
        EnvironmentLinks.layer.pipe(Layer.provide(Layer.succeed(RelayDb.RelayDb, fakeDb))),
      ),
    );
  });

  it.effect("identifies delivery-user list failures without retaining key material", () => {
    const cause = new Error("database unavailable");
    const fakeDb = {
      select: () => ({
        from: (table: unknown) => {
          expect(table).toBe(relayEnvironmentLinks);
          return {
            where: () => Effect.fail(cause),
          };
        },
      }),
    } as unknown as RelayDb.RelayDb["Service"];

    return Effect.gen(function* () {
      const links = yield* EnvironmentLinks.EnvironmentLinks;
      const error = yield* Effect.flip(
        links.listDeliveryUsersForEnvironment({
          environmentId: "env-1",
          environmentPublicKey: "sensitive-public-key-material",
        }),
      );

      expect(error).toMatchObject({
        _tag: "EnvironmentLinkUserListPersistenceError",
        operation: "list-delivery-users",
        environmentId: "env-1",
      });
      expect(error.cause).toBe(cause);
      expect(error).not.toHaveProperty("environmentPublicKey");
    }).pipe(
      Effect.provide(
        EnvironmentLinks.layer.pipe(Layer.provide(Layer.succeed(RelayDb.RelayDb, fakeDb))),
      ),
    );
  });

  it.effect("selects users when either notifications or Live Activities are enabled", () => {
    const whereConditions: Array<SQL> = [];
    const fakeDb = {
      select: (selection: unknown) => {
        expect(selection).toBeDefined();
        return {
          from: (table: unknown) => {
            expect(table).toBe(relayEnvironmentLinks);
            return {
              where: (condition: SQL) => {
                whereConditions.push(condition);
                return Effect.succeed([]);
              },
            };
          },
        };
      },
    } as unknown as RelayDb.RelayDb["Service"];

    return Effect.gen(function* () {
      const links = yield* EnvironmentLinks.EnvironmentLinks;
      expect(yield* links.listUsersForEnvironment({ environmentId: "env-1" })).toEqual([]);
      expect(whereConditions).toHaveLength(1);

      const query = new PgDialect().sqlToQuery(whereConditions[0]!);
      expect(query.sql).toContain('"relay_environment_links"."environment_id" = $1');
      expect(query.sql).toContain('"relay_environment_links"."revoked_at" is null');
      expect(query.sql).toContain('"relay_environment_links"."notifications_enabled" = $2');
      expect(query.sql).toContain('"relay_environment_links"."live_activities_enabled" = $3');
      expect(query.sql).toContain(" or ");
      expect(query.params).toEqual(["env-1", true, true]);
    }).pipe(
      Effect.provide(
        EnvironmentLinks.layer.pipe(Layer.provide(Layer.succeed(RelayDb.RelayDb, fakeDb))),
      ),
    );
  });

  it.effect("revokes only the active link owned by the requesting user", () => {
    const updateValues: Array<Record<string, unknown>> = [];
    const whereConditions: Array<SQL> = [];
    const fakeDb = {
      update: (table: unknown) => {
        expect(table).toBe(relayEnvironmentLinks);
        return {
          set: (values: Record<string, unknown>) => {
            updateValues.push(values);
            return {
              where: (condition: SQL) => {
                whereConditions.push(condition);
                return {
                  returning: (selection: unknown) => {
                    expect(selection).toBeDefined();
                    return Effect.succeed([{ environmentId: "env-1" }]);
                  },
                };
              },
            };
          },
        };
      },
    } as unknown as RelayDb.RelayDb["Service"];

    return Effect.gen(function* () {
      const links = yield* EnvironmentLinks.EnvironmentLinks;
      const revoked = yield* links.revokeForUser({
        userId: "user-1",
        environmentId: "env-1",
      });

      expect(revoked).toBe(true);
      expect(updateValues).toHaveLength(1);
      expect(updateValues[0]?.revokedAt).toEqual(updateValues[0]?.updatedAt);
      expect(typeof updateValues[0]?.revokedAt).toBe("string");
      expect(whereConditions).toHaveLength(1);

      const dialect = new PgDialect();
      const query = dialect.sqlToQuery(whereConditions[0]!);
      expect(query.sql).toContain('"relay_environment_links"."user_id" = $1');
      expect(query.sql).toContain('"relay_environment_links"."environment_id" = $2');
      expect(query.sql).toContain('"relay_environment_links"."revoked_at" is null');
      expect(query.params).toEqual(["user-1", "env-1"]);
    }).pipe(
      Effect.provide(
        EnvironmentLinks.layer.pipe(Layer.provide(Layer.succeed(RelayDb.RelayDb, fakeDb))),
      ),
    );
  });
});
