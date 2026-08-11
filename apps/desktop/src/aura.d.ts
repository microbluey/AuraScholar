// The preload bridge (electron/preload.ts) exposes its API on window.aura.
// Importing the type keeps the renderer in lockstep with the bridge surface.
import type { AuraApi } from "../electron/preload";

type AssertFalse<Value extends false> = Value;
// The raw SQL bridge may exist in the dedicated smoke process but is not part
// of the production renderer API contract.
type _AuraApiExcludesRawDatabase = AssertFalse<"db" extends keyof AuraApi ? true : false>;
// All credentials are main-owned. The renderer only sees non-secret setting
// snapshots and invokes narrow data commands.
type _AuraApiExcludesSecrets = AssertFalse<"secrets" extends keyof AuraApi ? true : false>;
// Network access is owned by narrow main-process commands; no renderer API can
// proxy arbitrary HTTP requests or their cancellation handles.
type _AuraApiExcludesGenericHttp = AssertFalse<"http" extends keyof AuraApi ? true : false>;
type _AuraApiExcludesGenericHttpCancel = AssertFalse<
  "cancelHttp" extends keyof AuraApi ? true : false
>;
// These renderer capabilities had no production consumer. Keep clipboard
// writing, but do not reintroduce clipboard reads, device identity, external
// shell launches, or local citation-service discovery through preload.
type _AuraApiExcludesClipboardReadText = AssertFalse<
  "readText" extends keyof AuraApi["clipboard"] ? true : false
>;
type _AuraApiExcludesDeviceId = AssertFalse<"deviceId" extends keyof AuraApi ? true : false>;
type _AuraApiExcludesOpenExternal = AssertFalse<
  "openExternal" extends keyof AuraApi ? true : false
>;
type _AuraApiExcludesCitationBridgePort = AssertFalse<
  "citationBridgePort" extends keyof AuraApi ? true : false
>;

declare global {
  interface Window {
    aura: AuraApi;
  }
}

export {};
