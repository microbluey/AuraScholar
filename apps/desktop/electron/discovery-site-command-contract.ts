/**
 * App-global Discovery configuration. These commands deliberately do not
 * carry a Library scope: site cards and research proxy settings exist before
 * a local Library is created and are shared by the desktop application.
 */

export interface DiscoverySiteCommandSite {
  id: string;
  name: string;
  homeUrl: string;
  searchUrl?: string;
  builtin: boolean;
  hidden: boolean;
  sortOrder: number;
  useProxy: boolean;
}

export interface DiscoverySiteSettings {
  proxyAddress: string;
  ezproxyPrefix: string;
}

export type DiscoverySiteEmptyCommandInput = Record<string, never>;

export interface DiscoverySiteAddCommandInput {
  name: string;
  homeUrl: string;
  searchUrl?: string;
}

export interface DiscoverySiteAddCommandResult {
  created: boolean;
  status: "created" | "existing" | "restored";
  site: DiscoverySiteCommandSite;
}

export interface DiscoverySiteSetProxyCommandInput {
  siteId: string;
  useProxy: boolean;
}

export interface DiscoverySiteSetHiddenCommandInput {
  siteId: string;
  hidden: boolean;
}

export interface DiscoverySiteRemoveCommandInput {
  siteId: string;
}

/** A custom-site snapshot supplied by the UI's delete undo action. */
export interface DiscoverySiteRestoreCommandInput {
  id: string;
  name: string;
  homeUrl: string;
  searchUrl?: string;
  sortOrder: number;
  useProxy: boolean;
}

/** Only the two research settings can be changed through this command. */
export type DiscoverySiteSetSettingsCommandInput =
  | { proxyAddress: string; ezproxyPrefix?: string }
  | { proxyAddress?: string; ezproxyPrefix: string };

export interface DiscoverySiteMutationCommandResult {
  updated: 1;
}

export interface DiscoverySiteListCommandResult {
  sites: DiscoverySiteCommandSite[];
}

export interface DiscoverySiteGetSettingsCommandResult {
  settings: DiscoverySiteSettings;
}

export interface DiscoverySiteDataCommandMap {
  "discoverySite.listSites": {
    input: DiscoverySiteEmptyCommandInput;
    output: DiscoverySiteListCommandResult;
  };
  "discoverySite.getSettings": {
    input: DiscoverySiteEmptyCommandInput;
    output: DiscoverySiteGetSettingsCommandResult;
  };
  "discoverySite.addSite": {
    input: DiscoverySiteAddCommandInput;
    output: DiscoverySiteAddCommandResult;
  };
  "discoverySite.setSiteProxy": {
    input: DiscoverySiteSetProxyCommandInput;
    output: DiscoverySiteMutationCommandResult;
  };
  "discoverySite.setSiteHidden": {
    input: DiscoverySiteSetHiddenCommandInput;
    output: DiscoverySiteMutationCommandResult;
  };
  "discoverySite.removeSite": {
    input: DiscoverySiteRemoveCommandInput;
    output: DiscoverySiteMutationCommandResult;
  };
  "discoverySite.restoreSite": {
    input: DiscoverySiteRestoreCommandInput;
    output: DiscoverySiteMutationCommandResult;
  };
  "discoverySite.setSettings": {
    input: DiscoverySiteSetSettingsCommandInput;
    output: DiscoverySiteGetSettingsCommandResult;
  };
}
