import type {
    GenerateAuthenticationOptionsOpts,
    GenerateRegistrationOptionsOpts,
    VerifyAuthenticationResponseOpts,
    VerifyRegistrationResponseOpts,
} from "@simplewebauthn/server";
import {
    generateAuthenticationOptions,
    generateRegistrationOptions,
    verifyAuthenticationResponse,
    verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { logger } from "../utils/logger";
import * as storageService from "./storageService";

// RP (Relying Party) configuration
const rpName = "MyTube";
const rpID = process.env.RP_ID || "localhost"; // Default to localhost for development
export const defaultOrigin = process.env.ORIGIN || `http://${rpID}:5550`; // Frontend origin
const origin = defaultOrigin;

// Storage key for passkeys
const PASSKEYS_STORAGE_KEY = "passkeys";

interface StoredPasskey {
  credentialID: string; // Base64url encoded
  credentialPublicKey: string; // Base64 encoded
  counter: number;
  transports?: string[];
  id: string; // Same as credentialID for convenience
  name?: string;
  createdAt: string;
  rpID?: string; // Store the RP_ID used during registration for debugging
  origin?: string; // Store the origin used during registration for debugging
}

/**
 * Get all stored passkeys
 */
export function getPasskeys(): StoredPasskey[] {
  try {
    const settings = storageService.getSettings();
    const passkeys = settings[PASSKEYS_STORAGE_KEY];
    if (!passkeys || !Array.isArray(passkeys)) {
      return [];
    }
    return passkeys;
  } catch (error) {
    logger.error(
      "Error getting passkeys",
      error instanceof Error ? error : new Error(String(error))
    );
    return [];
  }
}

/**
 * Save passkeys to storage
 */
function savePasskeys(passkeys: StoredPasskey[]): void {
  try {
    storageService.saveSettings({
      [PASSKEYS_STORAGE_KEY]: passkeys,
    });
  } catch (error) {
    logger.error(
      "Error saving passkeys",
      error instanceof Error ? error : new Error(String(error))
    );
    throw error;
  }
}

/**
 * Generate registration options for creating a new passkey
 */
export async function generatePasskeyRegistrationOptions(
  userName: string = "MyTube User",
  originOverride?: string,
  rpIDOverride?: string
): Promise<{
  options: any;
  challenge: string;
}> {
  const existingPasskeys = getPasskeys();
  const effectiveRPID = rpIDOverride || rpID;

  const opts: GenerateRegistrationOptionsOpts = {
    rpName,
    rpID: effectiveRPID,
    userID: Buffer.from(userName),
    userName,
    timeout: 60000,
    attestationType: "none",
    excludeCredentials: existingPasskeys.map((passkey) => ({
      id: Buffer.from(passkey.credentialID, "base64url").toString("base64url"),
      type: "public-key" as const,
      transports: passkey.transports as any,
    })),
    authenticatorSelection: {
      authenticatorAttachment: "platform",
      userVerification: "preferred",
      requireResidentKey: false,
    },
    supportedAlgorithmIDs: [-7, -257], // ES256 and RS256
  };

  const options = await generateRegistrationOptions(opts);

  // Store challenge temporarily (in a real app, you'd use a session or cache)
  // For simplicity, we'll return it and the frontend will send it back
  return {
    options,
    challenge: options.challenge,
  };
}

/**
 * Verify and store a new passkey
 */
export async function verifyPasskeyRegistration(
  body: any,
  challenge: string,
  originOverride?: string,
  rpIDOverride?: string
): Promise<{ verified: boolean; passkey?: StoredPasskey }> {
  try {
    const existingPasskeys = getPasskeys();
    const effectiveRPID = rpIDOverride || rpID;
    const effectiveOrigin = originOverride || origin;

    logger.info(
      `Verifying passkey registration with RP_ID: ${effectiveRPID}, Origin: ${effectiveOrigin}`
    );

    const opts: VerifyRegistrationResponseOpts = {
      response: body,
      expectedChallenge: challenge,
      expectedOrigin: effectiveOrigin,
      expectedRPID: effectiveRPID,
      requireUserVerification: false,
    };

    const verification = await verifyRegistrationResponse(opts);

    if (verification.verified && verification.registrationInfo) {
      const { credential } = verification.registrationInfo;
      const credentialID = credential.id;
      const credentialPublicKey = Buffer.from(credential.publicKey).toString(
        "base64"
      );

      const newPasskey: StoredPasskey = {
        credentialID,
        credentialPublicKey,
        counter: credential.counter || 0,
        transports: body.response.transports || credential.transports || [],
        id: credentialID,
        name: body.name || `Passkey ${existingPasskeys.length + 1}`,
        createdAt: new Date().toISOString(),
        rpID: effectiveRPID, // Store RP_ID for debugging
        origin: effectiveOrigin, // Store origin for debugging
      };

      logger.info(
        `Passkey registered successfully with RP_ID: ${effectiveRPID}, Origin: ${effectiveOrigin}`
      );

      const updatedPasskeys = [...existingPasskeys, newPasskey];
      savePasskeys(updatedPasskeys);

      logger.info("New passkey registered successfully");
      return { verified: true, passkey: newPasskey };
    }

    return { verified: false };
  } catch (error) {
    logger.error(
      "Error verifying passkey registration",
      error instanceof Error ? error : new Error(String(error))
    );
    return { verified: false };
  }
}

/**
 * Generate authentication options for passkey login
 */
export async function generatePasskeyAuthenticationOptions(
  rpIDOverride?: string
): Promise<{
  options: any;
  challenge: string;
}> {
  const passkeys = getPasskeys();

  if (passkeys.length === 0) {
    throw new Error("No passkeys registered");
  }

  const effectiveRPID = rpIDOverride || rpID;

  logger.info(
    `Generating authentication options with RP_ID: ${effectiveRPID}, Found ${passkeys.length} passkey(s)`
  );

  // Log stored RP_IDs for debugging
  const storedRPIDs = passkeys.map((p) => p.rpID || "not set");
  logger.info(`Stored passkeys RP_IDs: ${storedRPIDs.join(", ")}`);

  // Filter passkeys to only include those that match the current RP_ID
  // This is critical - browsers will only find passkeys that match the RP_ID
  const matchingPasskeys = passkeys.filter((passkey) => {
    // If passkey has stored RP_ID, it must match
    if (passkey.rpID) {
      return passkey.rpID === effectiveRPID;
    }
    // For passkeys without stored RP_ID (legacy data), include them as fallback
    // This allows old passkeys to still work
    return true;
  });

  logger.info(
    `Using ${matchingPasskeys.length} passkey(s) matching RP_ID: ${effectiveRPID}`
  );

  if (matchingPasskeys.length === 0) {
    throw new Error(
      `No passkeys found for RP_ID: ${effectiveRPID}. Please create a new passkey.`
    );
  }

  // Since we only allow platform authenticators during registration (authenticatorAttachment: "platform"),
  // all passkeys should be platform authenticators. Explicitly set transports to ["internal"]
  // to ensure the browser uses the platform authenticator (fingerprint/face ID) instead of
  // falling back to cross-platform authentication (QR code)
  const opts: GenerateAuthenticationOptionsOpts = {
    timeout: 60000,
    allowCredentials: matchingPasskeys.map((passkey) => ({
      id: passkey.credentialID,
      type: "public-key" as const,
      // Always specify "internal" transport since we only register platform authenticators
      // This tells the browser to use the device's built-in authenticator (fingerprint/face ID)
      transports: ["internal"] as any,
    })),
    userVerification: "preferred",
    rpID: effectiveRPID,
  };

  const options = await generateAuthenticationOptions(opts);

  return {
    options,
    challenge: options.challenge,
  };
}

/**
 * Verify passkey authentication
 */
export async function verifyPasskeyAuthentication(
  body: any,
  challenge: string,
  originOverride?: string,
  rpIDOverride?: string
): Promise<{ verified: boolean }> {
  try {
    const passkeys = getPasskeys();
    // Find passkey by matching the credential ID
    // body.id is already in base64url format from the browser
    const passkey = passkeys.find((p) => p.credentialID === body.id);

    if (!passkey) {
      logger.warn("Passkey not found for authentication");
      return { verified: false };
    }

    const effectiveRPID = rpIDOverride || rpID;
    const effectiveOrigin = originOverride || origin;

    const opts: VerifyAuthenticationResponseOpts = {
      response: body,
      expectedChallenge: challenge,
      expectedOrigin: effectiveOrigin,
      expectedRPID: effectiveRPID,
      credential: {
        id: passkey.credentialID,
        publicKey: Buffer.from(passkey.credentialPublicKey, "base64") as any,
        counter: passkey.counter,
        transports: passkey.transports as any,
      },
      requireUserVerification: false,
    };

    const verification = await verifyAuthenticationResponse(opts);

    if (verification.verified) {
      // Update counter
      const updatedPasskeys = passkeys.map((p) =>
        p.credentialID === passkey.credentialID
          ? { ...p, counter: verification.authenticationInfo.newCounter }
          : p
      );
      savePasskeys(updatedPasskeys);

      logger.info("Passkey authentication successful");
      return { verified: true };
    }

    return { verified: false };
  } catch (error) {
    logger.error(
      "Error verifying passkey authentication",
      error instanceof Error ? error : new Error(String(error))
    );
    return { verified: false };
  }
}

/**
 * Remove all passkeys
 */
export function removeAllPasskeys(): void {
  try {
    savePasskeys([]);
    logger.info("All passkeys removed");
  } catch (error) {
    logger.error(
      "Error removing passkeys",
      error instanceof Error ? error : new Error(String(error))
    );
    throw error;
  }
}
