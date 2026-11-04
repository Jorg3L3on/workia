/**
 * Prints a new pair of VAPID keys for web push (W2-08). Free: VAPID is a
 * key pair, not an account with any provider. Put the three lines in the
 * environment (Jorge's step on Vercel); keep the private key secret. Changing
 * the keys later drops every saved phone, which must turn push on again.
 *
 *   npm run push:vapid-keys
 */
import webPush from "web-push";

const keys = webPush.generateVAPIDKeys();

console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log("VAPID_SUBJECT=mailto:soporte@tu-dominio.example");
