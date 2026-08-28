import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import * as OpenApi from "effect/unstable/httpapi/OpenApi";

import { RelayApi, RelayEnvironmentUnlinkResponse } from "./relay.ts";

const decodeRelayEnvironmentUnlinkResponse = Schema.decodeUnknownSync(
  RelayEnvironmentUnlinkResponse,
);

it("decodes unlink responses from relays that predate cleanup status", () => {
  expect(decodeRelayEnvironmentUnlinkResponse({ ok: true })).toEqual({
    ok: true,
  });
});

describe("RelayApi security", () => {
  it("describes DPoP access tokens using the HTTP DPoP authorization scheme", () => {
    const document = OpenApi.fromApi(RelayApi);

    expect(document.components.securitySchemes?.relayDpop).toEqual({
      type: "http",
      scheme: "DPoP",
      description: "DPoP-bound access token. Requests must also include the DPoP proof JWT header.",
    });
  });
});
