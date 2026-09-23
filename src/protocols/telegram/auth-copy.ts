export function describeCodeDelivery(type: string | undefined): string {
  switch (type) {
    case 'authenticationCodeTypeTelegramMessage':
      return 'Telegram sent the code to your other signed-in devices.';
    case 'authenticationCodeTypeSms':
    case 'authenticationCodeTypeSmsWord':
    case 'authenticationCodeTypeSmsPhrase':
      return 'Telegram sent the code by SMS.';
    case 'authenticationCodeTypeCall':
      return 'Telegram is calling you with the code.';
    case 'authenticationCodeTypeFlashCall':
    case 'authenticationCodeTypeMissedCall':
      return 'Telegram is calling you; the code is the last digits of the calling number.';
    case 'authenticationCodeTypeFragment':
      return 'The code is on fragment.com for this number.';
    default:
      return 'Enter the code Telegram sent you.';
  }
}

export function describeAuthError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('PHONE_NUMBER_INVALID'))
    return 'That is not a valid phone number. Include the country code, like +44.';
  if (message.includes('PHONE_NUMBER_UNOCCUPIED'))
    return 'There is no Telegram account for that number.';
  if (message.includes('PHONE_NUMBER_BANNED')) return 'Telegram has banned that number.';
  if (message.includes('PHONE_CODE_INVALID')) return 'That code is not right.';
  if (message.includes('PHONE_CODE_EXPIRED'))
    return 'That code has expired. Save and reconnect to get a new one.';
  if (message.includes('PASSWORD_HASH_INVALID')) return 'Wrong password.';
  if (message.includes('API_ID_INVALID') || message.includes('API_ID_PUBLISHED_FLOOD')) {
    return 'Telegram rejected the API ID and hash. Check them at my.telegram.org.';
  }
  const flood = message.match(/retry after (\d+)/i);
  if (flood) return `Too many attempts. Wait ${flood[1]} seconds before trying again.`;
  return message;
}
