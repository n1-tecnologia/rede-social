import type { ApiErrorEnvelope, ErrorCode } from '@tria/contracts';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

/** pt-BR messages per stable code. Bodies never name tenants unless `details` is set on purpose. */
export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  UNAUTHENTICATED: 'Faça login para continuar.',
  INVALID_TOKEN: 'Sua sessão é inválida ou expirou. Faça login novamente.',
  NO_MEMBERSHIP: 'Sua conta não pertence a nenhuma comunidade.',
  MEMBERSHIP_BLOCKED: 'Seu acesso foi suspenso.',
  TENANT_SUSPENDED: 'Esta comunidade está temporariamente indisponível.',
  TENANT_HOST_MISMATCH: 'Este endereço não pertence à sua comunidade.',
  MODULE_DISABLED: 'Este recurso não está disponível na sua comunidade.',
  FORBIDDEN: 'Você não tem permissão para fazer isso.',
  EMAIL_ALREADY_REGISTERED: 'Este e-mail já está cadastrado. Entre com sua senha.',
  TENANT_NOT_FOUND: 'Comunidade não encontrada.',
  VALIDATION_FAILED: 'Dados inválidos.',
  NOT_FOUND: 'Não encontrado.',
  INTERNAL: 'Erro interno',
};

/** Throw this from routes/middleware; `errorEnvelope` turns it into the stable envelope. */
export class ApiError extends HTTPException {
  readonly code: ErrorCode;
  readonly details: Record<string, unknown> | undefined;

  constructor(status: ContentfulStatusCode, code: ErrorCode, details?: Record<string, unknown>) {
    super(status, { message: ERROR_MESSAGES[code] });
    this.code = code;
    this.details = details;
  }
}

export function errorEnvelope(
  err: unknown,
  requestId: string,
): { body: ApiErrorEnvelope; status: ContentfulStatusCode } {
  if (err instanceof ApiError) {
    return {
      body: {
        error: {
          code: err.code,
          message: ERROR_MESSAGES[err.code],
          ...(err.details ? { details: err.details } : {}),
          requestId,
        },
      },
      status: err.status as ContentfulStatusCode,
    };
  }
  if (err instanceof HTTPException) {
    return {
      body: {
        error: { code: 'HTTP_ERROR', message: err.message || 'Erro na requisição', requestId },
      },
      status: err.status as ContentfulStatusCode,
    };
  }
  return {
    body: { error: { code: 'INTERNAL', message: ERROR_MESSAGES.INTERNAL, requestId } },
    status: 500,
  };
}
