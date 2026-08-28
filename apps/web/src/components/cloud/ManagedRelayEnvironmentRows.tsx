import type { RelayClientEnvironmentRecord } from "@t3tools/contracts/relay";

import { useManagedRelayEnvironmentRemoval } from "~/cloud/useManagedRelayEnvironmentRemoval";
import { useEnvironments, usePrimaryEnvironment } from "~/state/environments";
import { ITEM_ROW_CLASSNAME, ITEM_ROW_INNER_CLASSNAME } from "../settings/itemRows";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";

function endpointLabel(environment: RelayClientEnvironmentRecord): string {
  return environment.endpoint.providerKind === "cloudflare_tunnel"
    ? "Managed tunnel"
    : "Activity publishing only";
}

export function ManagedRelayEnvironmentRows() {
  const removal = useManagedRelayEnvironmentRemoval();
  const { environmentsState, pendingEnvironmentId } = removal;
  const { environments: localEnvironments } = useEnvironments();
  const primaryEnvironment = usePrimaryEnvironment();

  if (!environmentsState.accountId) return null;
  if (environmentsState.data === null && !environmentsState.error) {
    return <p className={`${ITEM_ROW_CLASSNAME} text-sm text-muted-foreground`}>Loading...</p>;
  }
  if (environmentsState.error) {
    return (
      <div className={ITEM_ROW_CLASSNAME} role="alert">
        <p className="text-sm font-medium text-destructive">Could not load account environments</p>
        <p className="mt-1 text-xs text-muted-foreground">{environmentsState.error}</p>
        <Button className="mt-3" size="sm" variant="outline" onClick={environmentsState.refresh}>
          Try again
        </Button>
      </div>
    );
  }

  const environments = environmentsState.data ?? [];
  const selectedLocalEnvironment = localEnvironments.find(
    (environment) => environment.environmentId === removal.confirmingEnvironmentId,
  );
  const connectionWarning =
    selectedLocalEnvironment?.entry.target._tag === "RelayConnectionTarget"
      ? " This client is using T3 Connect for this environment. The connection can close after removal."
      : removal.confirmingEnvironmentId === primaryEnvironment?.environmentId
        ? " This is the current environment. Its local connection and session are not removed."
        : null;
  return (
    <>
      {environments.length === 0 ? (
        <p className={`${ITEM_ROW_CLASSNAME} text-sm text-muted-foreground`}>
          No environments are registered to this account.
        </p>
      ) : (
        environments.map((environment) => (
          <div key={environment.environmentId} className={ITEM_ROW_CLASSNAME}>
            <div className={ITEM_ROW_INNER_CLASSNAME}>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{environment.label}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {environment.cleanupPending ? "Cleanup pending" : endpointLabel(environment)}
                </p>
              </div>
              <Button
                size="sm"
                variant="destructive-outline"
                disabled={pendingEnvironmentId !== null}
                onClick={() => removal.setConfirmingEnvironmentId(environment.environmentId)}
              >
                {environment.cleanupPending ? "Retry cleanup" : "Remove from T3 Connect"}
              </Button>
            </div>
          </div>
        ))
      )}

      <AlertDialog
        open={removal.confirmingEnvironmentId !== null}
        onOpenChange={(open) => {
          if (!open && pendingEnvironmentId === null) removal.setConfirmingEnvironmentId(null);
        }}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {environments.find((item) => item.environmentId === removal.confirmingEnvironmentId)
                ?.cleanupPending
                ? "Retry T3 Connect cleanup?"
                : `Remove ${environments.find((item) => item.environmentId === removal.confirmingEnvironmentId)?.label ?? "environment"} from T3 Connect?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {environments.find((item) => item.environmentId === removal.confirmingEnvironmentId)
                ?.cleanupPending
                ? "This environment is already removed from your account. Stop the running host before retrying tunnel cleanup."
                : "This removes the environment from your account and stops activity publishing. Tunnel cleanup can require the running host to stop. Files, agents, and direct connections are not changed."}
              {connectionWarning}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose
              render={<Button variant="outline" disabled={pendingEnvironmentId !== null} />}
            >
              Cancel
            </AlertDialogClose>
            <Button
              variant="destructive"
              disabled={pendingEnvironmentId !== null}
              onClick={() => {
                const environment = environments.find(
                  (item) => item.environmentId === removal.confirmingEnvironmentId,
                );
                if (environment) void removal.removeEnvironment(environment);
              }}
            >
              {pendingEnvironmentId !== null
                ? "Working..."
                : environments.find(
                      (item) => item.environmentId === removal.confirmingEnvironmentId,
                    )?.cleanupPending
                  ? "Retry cleanup"
                  : "Remove from T3 Connect"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </>
  );
}
