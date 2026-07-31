import type { ConnectorContext } from "@aurascholar/connectors";
import { auraHttp } from "./aura-platform";

export const connectorContext: ConnectorContext = {
  http: auraHttp,
  mailto: "contact@aurascholar.app",
};
