import { useTranslation, type TranslationKey } from '../i18n';

/**
 * Maps a stable `ApiError.code` from the backend to its localized copy key.
 * Returns null for codes this build does not know about, so the raw provider
 * message is shown instead of a generic string.
 */
export function errorTitleKey(code: string): TranslationKey | null {
  switch (code) {
    case 'missing_api_key':
      return 'error.missingApiKey';
    case 'missing_model':
      return 'error.missingModel';
    case 'unauthorized':
      return 'error.unauthorized';
    case 'forbidden':
      return 'error.forbidden';
    case 'rate_limited':
      return 'error.rateLimited';
    case 'server_error':
      return 'error.serverError';
    case 'network':
      return 'error.network';
    case 'model_not_found':
      return 'error.modelNotFound';
    case 'bad_request':
      return 'error.badRequest';
    case 'context_length_exceeded':
      return 'error.contextLengthExceeded';
    case 'cancelled':
      return 'error.cancelled';
    case 'unknown':
      return 'error.unknown';
    default:
      return null;
  }
}

interface ErrorCardProps {
  /** Stable error key emitted by the backend. */
  code: string;
  /** Raw provider detail, shown as the subtitle when present. */
  message: string;
}

/**
 * Renders a Minimal Line error callout inline in the chat thread.
 * The title is the localized copy for the error code (or the raw message when
 * the code is unknown); the subtitle is the raw provider detail.
 */
export function ErrorCard({ code, message }: ErrorCardProps) {
  const { t } = useTranslation();
  const titleKey = errorTitleKey(code);
  const muted = titleKey === null || code === 'cancelled';
  const warning =
    code === 'missing_api_key' ||
    code === 'missing_model' ||
    code === 'model_not_found' ||
    code === 'bad_request' ||
    code === 'rate_limited' ||
    code === 'context_length_exceeded';

  const barColor = muted
    ? 'rgba(255,255,255,0.2)'
    : warning
      ? '#f59e0b'
      : '#ef4444';

  const title = titleKey ? t(titleKey) : message;
  const subtitle = titleKey && message ? message : null;

  return (
    <div className="flex items-stretch gap-3 px-1 py-2 rounded-md bg-white/[0.025]">
      <div
        data-error-bar
        data-kind={code}
        className="w-[2.5px] rounded-sm flex-shrink-0 self-stretch min-h-[36px]"
        style={{ background: barColor }}
      />
      <div>
        <p className="text-[12.5px] font-[590] text-white/[0.82] leading-snug tracking-[-0.01em]">
          {title}
        </p>
        {subtitle && (
          <p className="text-[11.5px] text-white/[0.38] leading-snug mt-0.5">
            {subtitle}
          </p>
        )}
      </div>
    </div>
  );
}
