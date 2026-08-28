import type { RelayClientEnvironmentRecord } from "@t3tools/contracts/relay";
import { ServerIcon } from "lucide-react";

import { useManagedRelayEnvironmentRemoval } from "../../cloud/useManagedRelayEnvironmentRemoval";
import { Button } from "../ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import {
  ClerkUserProfilePage,
  ClerkUserProfileRefreshButton,
  ClerkUserProfileRow,
} from "./ClerkUserProfilePage";

const linkedAtFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

function linkedAtLabel(value: string): string {
  const linkedAt = new Date(value);
  return Number.isNaN(linkedAt.getTime())
    ? "Link date unavailable"
    : `Linked ${linkedAtFormatter.format(linkedAt)}`;
}

function endpointLabel(environment: RelayClientEnvironmentRecord): string {
  return environment.endpoint.providerKind === "cloudflare_tunnel"
    ? "Managed tunnel"
    : "Activity publishing only";
}

export function T3ConnectEnvironmentRow(props: {
  readonly environment: RelayClientEnvironmentRecord;
  readonly confirmationOpen: boolean;
  readonly mutationPending: boolean;
  readonly onConfirmationChange: (open: boolean) => void;
  readonly onDeregister: (environment: RelayClientEnvironmentRecord) => void;
}) {
  const { environment } = props;
  return (
    <ClerkUserProfileRow icon={<ServerIcon className="size-4" />}>
      <Collapsible open={props.confirmationOpen} onOpenChange={props.onConfirmationChange}>
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-[0.8125rem] leading-[1.125rem] font-medium text-foreground">
              {environment.label}
            </h3>
            <p className="mt-1 text-xs leading-[1.125rem] text-muted-foreground">
              {environment.cleanupPending
                ? "Removed from account - cleanup pending"
                : `${linkedAtLabel(environment.linkedAt)} - ${endpointLabel(environment)}`}
            </p>
          </div>
          <CollapsibleTrigger
            render={
              <Button
                size="sm"
                variant="destructive-outline"
                className="text-[0.8125rem]"
                disabled={props.mutationPending}
              >
                {environment.cleanupPending ? "Retry cleanup" : "Remove"}
              </Button>
            }
          />
        </div>

        <CollapsiblePanel>
          <div className="pt-3">
            <div
              className="rounded-lg border border-input bg-muted/32 px-5 py-4 shadow-xs/5"
              role="group"
              aria-label={`Confirm removal of ${environment.label}`}
            >
              <h4 className="text-[0.8125rem] leading-[1.125rem] font-semibold text-foreground">
                {environment.cleanupPending ? "Retry cleanup" : "Remove from T3 Connect"}
              </h4>
              <p className="mt-1 text-[0.8125rem] leading-[1.125rem] text-muted-foreground">
                "{environment.label}"{" "}
                {environment.cleanupPending
                  ? "is already removed."
                  : "will be removed from this account."}
              </p>
              <p className="mt-4 max-w-xl text-[0.8125rem] leading-[1.125rem] text-muted-foreground">
                {environment.cleanupPending
                  ? "Stop the running host, then retry cleanup. Local connections are not changed."
                  : "T3 Connect account access and activity publishing will stop. Tunnel cleanup can require the running host to stop. Local connections are not changed."}
              </p>
              <div className="mt-4 flex justify-end gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-[0.8125rem]"
                  disabled={props.mutationPending}
                  onClick={() => props.onConfirmationChange(false)}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  className="text-[0.8125rem]"
                  disabled={props.mutationPending}
                  onClick={() => props.onDeregister(environment)}
                >
                  {props.mutationPending
                    ? "Working..."
                    : environment.cleanupPending
                      ? "Retry cleanup"
                      : "Remove"}
                </Button>
              </div>
            </div>
          </div>
        </CollapsiblePanel>
      </Collapsible>
    </ClerkUserProfileRow>
  );
}

export function T3ConnectUserProfilePage() {
  const removal = useManagedRelayEnvironmentRemoval();
  const { environmentsState } = removal;

  const environments = environmentsState.data ?? [];
  const isInitialLoad =
    !environmentsState.accountId || (environmentsState.data === null && !environmentsState.error);

  return (
    <ClerkUserProfilePage
      title="T3 Connect"
      description="Environments registered to your account. Connections on this device are managed in Settings."
      action={
        <ClerkUserProfileRefreshButton
          disabled={removal.pendingEnvironmentId !== null}
          isPending={environmentsState.isPending}
          onClick={environmentsState.refresh}
        />
      }
    >
      <div>
        {environmentsState.error ? (
          <div className="mb-4 border-t border-destructive/35 py-3 text-[0.8125rem]" role="alert">
            <p className="font-medium text-destructive-foreground">
              Could not load T3 Connect environments
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{environmentsState.error}</p>
          </div>
        ) : null}

        {isInitialLoad ? (
          <p className="border-t py-4 text-[0.8125rem] text-muted-foreground" role="status">
            Loading environments…
          </p>
        ) : environments.length > 0 ? (
          <ul className="border-t">
            {environments.map((environment) => (
              <T3ConnectEnvironmentRow
                key={environment.environmentId}
                environment={environment}
                confirmationOpen={removal.confirmingEnvironmentId === environment.environmentId}
                mutationPending={removal.pendingEnvironmentId !== null}
                onConfirmationChange={(open) =>
                  removal.pendingEnvironmentId === null &&
                  removal.setConfirmingEnvironmentId(open ? environment.environmentId : null)
                }
                onDeregister={(selected) => void removal.removeEnvironment(selected)}
              />
            ))}
          </ul>
        ) : environmentsState.error ? null : (
          <Empty className="min-h-64 gap-4 border-t px-6 py-10 md:p-10">
            <EmptyMedia className="mb-0" variant="icon">
              <ServerIcon />
            </EmptyMedia>
            <EmptyHeader>
              <EmptyTitle className="text-[1.0625rem] leading-6">
                No T3 Connect environments
              </EmptyTitle>
              <EmptyDescription className="text-[0.8125rem] leading-[1.125rem]">
                Link an environment from its local Settings to make it available through T3 Connect.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </div>
    </ClerkUserProfilePage>
  );
}
