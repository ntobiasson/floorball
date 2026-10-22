import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';

/**
 * Reads the Turnstile secret out of Secrets Manager, once per execution
 * environment.
 *
 * Why not a Lambda environment variable: the stack deliberately carries no
 * credential in the function's environment, and `packages/infra` has a test
 * that fails if one appears there. Only the ARN is passed in, which is a
 * pointer and not a secret.
 *
 * Why lazily rather than at cold start: the read routes — the landing page's
 * only calls — never need the value, and making every cold start wait on
 * Secrets Manager would slow the one request a person is actually waiting
 * for. The first gated write pays for it, and nothing after that does.
 */
export function createSecretReader(secretArn: string, region?: string): () => Promise<string> {
  const client = new SecretsManagerClient(region === undefined ? {} : { region });
  let cached: Promise<string> | undefined;

  const read = async (): Promise<string> => {
    const { SecretString } = await client.send(new GetSecretValueCommand({ SecretId: secretArn }));
    if (SecretString === undefined || SecretString.trim().length === 0) {
      throw new Error(`the secret at ${secretArn} is empty`);
    }
    return SecretString.trim();
  };

  return () => {
    // A failed read is not cached: Secrets Manager throttles, and one
    // throttled response must not disable every write until the next cold
    // start.
    cached ??= read().catch((error: unknown) => {
      cached = undefined;
      throw error;
    });
    return cached;
  };
}
