import { cloudflaredService } from "../../services/cloudflaredService";
import { Settings } from "../../types/settings";

const hasOwnSetting = (
  settings: Partial<Settings>,
  key: keyof Settings
): boolean => Object.prototype.hasOwnProperty.call(settings, key);

const didCloudflaredEnabledChange = (
  existingSettings: Settings,
  settingsToPersist: Partial<Settings>
): boolean => {
  if (!hasOwnSetting(settingsToPersist, "cloudflaredTunnelEnabled")) {
    return false;
  }
  return (
    settingsToPersist.cloudflaredTunnelEnabled !==
    existingSettings.cloudflaredTunnelEnabled
  );
};

const didCloudflaredTokenChange = (
  existingSettings: Settings,
  settingsToPersist: Partial<Settings>
): boolean => {
  if (!hasOwnSetting(settingsToPersist, "cloudflaredToken")) {
    return false;
  }
  return settingsToPersist.cloudflaredToken !== existingSettings.cloudflaredToken;
};

const getCloudflaredPort = (): number =>
  process.env.PORT ? parseInt(process.env.PORT) : 5551;

const restartCloudflared = (settings: Settings, port: number): void => {
  if (settings.cloudflaredToken) {
    cloudflaredService.restart(settings.cloudflaredToken);
    return;
  }
  cloudflaredService.restart(undefined, port);
};

const startCloudflared = (settings: Settings, port: number): void => {
  if (settings.cloudflaredToken) {
    cloudflaredService.start(settings.cloudflaredToken);
    return;
  }
  cloudflaredService.start(undefined, port);
};

export const applyCloudflaredSettingChanges = (
  existingSettings: Settings,
  settingsToPersist: Partial<Settings>,
  finalSettings: Settings
): void => {
  const cloudflaredEnabledChanged = didCloudflaredEnabledChange(
    existingSettings,
    settingsToPersist
  );
  const cloudflaredTokenChanged = didCloudflaredTokenChange(
    existingSettings,
    settingsToPersist
  );

  if (!cloudflaredEnabledChanged && !cloudflaredTokenChanged) {
    return;
  }

  if (!finalSettings.cloudflaredTunnelEnabled) {
    if (cloudflaredEnabledChanged) {
      cloudflaredService.stop();
    }
    return;
  }

  const port = getCloudflaredPort();
  if (existingSettings.cloudflaredTunnelEnabled) {
    restartCloudflared(finalSettings, port);
    return;
  }

  startCloudflared(finalSettings, port);
};
