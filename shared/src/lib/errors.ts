// Normalizes errors thrown by PocketBase (and generic errors) into a small,
// predictable shape the UI can display.

export type AuthErrorType =
  'validation' | 'auth' | 'network' | 'server' | 'unknown';

export interface ParsedAuthError {
  type: AuthErrorType;
  message: string;
  /** Field-level messages keyed by field name, when available. */
  fieldErrors?: Record<string, string>;
}

interface PocketBaseErrorLike {
  status?: number;
  message?: string;
  response?: {
    message?: string;
    data?: Record<string, { message?: string }>;
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Turn an unknown thrown value into a `ParsedAuthError`. Understands the shape
 * of PocketBase `ClientResponseError` but degrades gracefully for anything else.
 */
export function parseAuthError(error: unknown): ParsedAuthError {
  if (!isObject(error)) {
    return {
      type: 'unknown',
      message:
        typeof error === 'string' ? error : 'An unexpected error occurred',
    };
  }

  const err = error as PocketBaseErrorLike;
  const status = err.status ?? 0;
  const response = err.response;

  // Extract field-level validation messages (PocketBase `response.data`).
  let fieldErrors: Record<string, string> | undefined;
  if (response?.data && isObject(response.data)) {
    fieldErrors = {};
    for (const [field, detail] of Object.entries(response.data)) {
      if (detail?.message) fieldErrors[field] = detail.message;
    }
    if (Object.keys(fieldErrors).length === 0) fieldErrors = undefined;
  }

  const baseMessage =
    response?.message || err.message || 'An unexpected error occurred';

  if (status === 0) {
    return {
      type: 'network',
      message: 'Unable to reach the server. Please check your connection.',
    };
  }
  if (status === 400 || status === 401 || status === 403) {
    return {
      type: status === 400 ? 'validation' : 'auth',
      message:
        status === 400
          ? baseMessage || 'Please check the information you entered.'
          : 'Invalid credentials. Please try again.',
      fieldErrors,
    };
  }
  if (status >= 500) {
    return {
      type: 'server',
      message: 'The server encountered an error. Please try again later.',
    };
  }

  return { type: 'unknown', message: baseMessage, fieldErrors };
}

/**
 * Get the validation message for a specific form field, if the error carries
 * one (e.g. PocketBase `response.data.<field>.message`).
 */
export function getFieldError(
  error: unknown,
  field: string
): string | undefined {
  return parseAuthError(error).fieldErrors?.[field];
}

export interface ToastMessage {
  title: string;
  description?: string;
}

/**
 * Build a user-facing toast message for a failed operation. `context` describes
 * the action that failed, e.g. "Login" -> "Login failed".
 */
export function getToastMessage(error: unknown, context: string): ToastMessage {
  const parsed = parseAuthError(error);
  return {
    title: `${context} failed`,
    description: parsed.message,
  };
}
