import { NativeHeaderToolbar } from "../../native/StackHeader";
import { useNavigation } from "@react-navigation/native";
import { SymbolView } from "../../components/AppSymbol";
import type { EnvironmentId } from "@t3tools/contracts";
import type { RelayClientEnvironmentRecord } from "@t3tools/contracts/relay";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useCallback, useRef, useState } from "react";
import { Alert, Platform, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useThemeColor } from "../../lib/useThemeColor";

import { AndroidScreenHeader } from "../../components/AndroidScreenHeader";
import { AppText as Text } from "../../components/AppText";
import { cn } from "../../lib/cn";
import { useRemoteConnections } from "../../state/use-remote-environment-registry";
import { ConnectionEnvironmentRow } from "./ConnectionEnvironmentRow";
import {
  deregisterManagedRelayEnvironmentCommand,
  useManagedRelayEnvironments,
} from "../cloud/managedRelayState";
import { relayEnvironmentDiscovery } from "../../state/relay";
import { useAtomCommand } from "../../state/use-atom-command";

function accountEnvironmentKind(environment: RelayClientEnvironmentRecord): string {
  return environment.endpoint.providerKind === "cloudflare_tunnel"
    ? "Managed tunnel"
    : "Activity publishing only";
}

export function ConnectionsRouteScreen() {
  const {
    connectedEnvironments,
    onReconnectEnvironment,
    onRemoveEnvironmentPress,
    onUpdateEnvironment,
  } = useRemoteConnections();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const hasEnvironments = connectedEnvironments.length > 0;
  const [expandedId, setExpandedId] = useState<EnvironmentId | null>(null);
  const accountEnvironments = useManagedRelayEnvironments();
  const removeAccountEnvironment = useAtomCommand(deregisterManagedRelayEnvironmentCommand, {
    reportFailure: false,
  });
  const refreshRelayEnvironments = useAtomCommand(relayEnvironmentDiscovery.refresh, {
    reportFailure: false,
  });
  const pendingRemovalRef = useRef(false);
  const currentAccountIdRef = useRef(accountEnvironments.accountId);
  const [removingEnvironmentId, setRemovingEnvironmentId] = useState<EnvironmentId | null>(null);
  currentAccountIdRef.current = accountEnvironments.accountId;

  const accentColor = useThemeColor("--color-icon-muted");
  const dangerFg = useThemeColor("--color-danger-foreground");

  const handleToggle = useCallback((environmentId: EnvironmentId) => {
    setExpandedId((prev) => (prev === environmentId ? null : environmentId));
  }, []);

  const removeFromT3Connect = useCallback(
    async (environment: RelayClientEnvironmentRecord) => {
      const accountId = accountEnvironments.accountId;
      if (!accountId || pendingRemovalRef.current) return;
      pendingRemovalRef.current = true;
      setRemovingEnvironmentId(environment.environmentId);
      const result = await removeAccountEnvironment({
        accountId,
        environmentId: environment.environmentId,
      });
      pendingRemovalRef.current = false;
      setRemovingEnvironmentId(null);

      if (currentAccountIdRef.current !== accountId) return;
      if (result._tag === "Success") {
        accountEnvironments.refresh();
        void refreshRelayEnvironments();
        if (result.value.cleanupPending) {
          Alert.alert(
            "Environment removed, cleanup pending",
            "Removed from your account. Tunnel cleanup is pending.",
          );
        }
        return;
      }
      if (isAtomCommandInterrupted(result)) return;
      const cause = squashAtomCommandFailure(result);
      Alert.alert(
        "Could not remove environment",
        cause instanceof Error ? cause.message : "The environment could not be removed.",
      );
    },
    [accountEnvironments, refreshRelayEnvironments, removeAccountEnvironment],
  );

  const confirmAccountRemoval = useCallback(
    (environment: RelayClientEnvironmentRecord) => {
      Alert.alert(
        environment.cleanupPending
          ? `Retry cleanup for ${environment.label}?`
          : `Remove ${environment.label} from T3 Connect?`,
        environment.cleanupPending
          ? "This environment is already removed from your account. Stop the running host before retrying tunnel cleanup."
          : "This removes account access and stops activity publishing. Tunnel cleanup can require the running host to stop. Files, agents, and direct connections are not changed.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: environment.cleanupPending ? "Retry cleanup" : "Remove",
            style: "destructive",
            onPress: () => void removeFromT3Connect(environment),
          },
        ],
      );
    },
    [removeFromT3Connect],
  );

  return (
    <View collapsable={false} className="flex-1 bg-sheet">
      {Platform.OS === "android" ? (
        <AndroidScreenHeader
          title="Environments"
          onBack={() => navigation.goBack()}
          actions={[
            {
              accessibilityLabel: "Add environment",
              icon: "plus",
              onPress: () => navigation.navigate("ConnectionsNew"),
            },
          ]}
        />
      ) : (
        <NativeHeaderToolbar placement="right">
          <NativeHeaderToolbar.Button
            icon="plus"
            onPress={() => navigation.navigate("ConnectionsNew")}
            separateBackground
          />
        </NativeHeaderToolbar>
      )}
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentContainerStyle={{
          paddingBottom: Math.max(insets.bottom, 18) + 18,
          paddingHorizontal: 20,
          paddingTop: 16,
        }}
      >
        {hasEnvironments ? (
          <View collapsable={false} className="overflow-hidden rounded-[24px] bg-card">
            {connectedEnvironments.map((environment, index) => (
              <View
                key={environment.environmentId}
                collapsable={false}
                className={cn(index !== 0 && "border-t border-border")}
              >
                <ConnectionEnvironmentRow
                  environment={environment}
                  expanded={expandedId === environment.environmentId}
                  onToggle={() => handleToggle(environment.environmentId)}
                  onReconnect={onReconnectEnvironment}
                  onRemove={onRemoveEnvironmentPress}
                  onUpdate={onUpdateEnvironment}
                />
              </View>
            ))}
          </View>
        ) : (
          <View collapsable={false} className="items-center gap-3 rounded-[24px] bg-card px-6 py-8">
            <View className="h-12 w-12 items-center justify-center rounded-[16px] bg-subtle">
              <SymbolView
                name="point.3.connected.trianglepath.dotted"
                size={20}
                tintColor={accentColor}
                type="monochrome"
              />
            </View>
            <Text className="text-center text-sm leading-normal text-foreground-muted">
              No environments connected yet.{"\n"}Tap{" "}
              <Text className="font-t3-bold text-foreground">+</Text> to add one.
            </Text>
          </View>
        )}

        {accountEnvironments.accountId ? (
          <View collapsable={false} className="mt-7 gap-2">
            <Text className="px-1 text-xs font-t3-bold uppercase text-foreground-muted">
              T3 Connect account
            </Text>
            <View collapsable={false} className="overflow-hidden rounded-[24px] bg-card">
              {accountEnvironments.error ? (
                <View className="gap-2 px-4 py-4">
                  <Text className="text-sm text-danger">Could not load account environments</Text>
                  <Pressable accessibilityRole="button" onPress={accountEnvironments.refresh}>
                    <Text className="text-sm font-t3-bold text-primary">Try again</Text>
                  </Pressable>
                </View>
              ) : accountEnvironments.data === null ? (
                <Text className="px-4 py-4 text-sm text-foreground-muted">Loading...</Text>
              ) : accountEnvironments.data.length === 0 ? (
                <Text className="px-4 py-4 text-sm text-foreground-muted">
                  No environments are registered to this account.
                </Text>
              ) : (
                accountEnvironments.data.map((environment, index) => (
                  <View
                    key={environment.environmentId}
                    className={cn(
                      "flex-row items-center gap-3 px-4 py-3.5",
                      index !== 0 && "border-t border-border",
                    )}
                  >
                    <View className="min-w-0 flex-1 gap-0.5">
                      <Text className="text-base font-t3-bold text-foreground" numberOfLines={1}>
                        {environment.label}
                      </Text>
                      <Text className="text-xs text-foreground-muted">
                        {environment.cleanupPending
                          ? "Cleanup pending"
                          : accountEnvironmentKind(environment)}
                      </Text>
                    </View>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={
                        environment.cleanupPending
                          ? `Retry cleanup for ${environment.label}`
                          : `Remove ${environment.label} from T3 Connect`
                      }
                      disabled={removingEnvironmentId !== null}
                      className="h-[42px] w-[42px] items-center justify-center rounded-[14px] border border-danger-border bg-danger active:opacity-70 disabled:opacity-40"
                      onPress={() => confirmAccountRemoval(environment)}
                    >
                      <SymbolView
                        name={environment.cleanupPending ? "arrow.clockwise" : "trash"}
                        size={14}
                        tintColor={dangerFg}
                        type="monochrome"
                      />
                    </Pressable>
                  </View>
                ))
              )}
            </View>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}
