// G · configuración global de RESPIRO. Los valores __ASI__ los rellena
// n8n/deploy.py al subir el flujo (nunca se guardan secretos en el repo).
return [{ json: {
  tg_base: '__TG_BASE__',
  tg_token: '__TG_TOKEN__',
  tg_secret: '__TG_SECRET__',
  bot_usuario: '__BOT_USUARIO__',
  gcal_base: '__GCAL_BASE__',
  anthropic_base: '__ANTHROPIC_BASE__',
  mistral_base: '__MISTRAL_BASE__',
  miniapp_url: '__MINIAPP_URL__',
  miniapp_secreto: '__MINIAPP_SECRETO__',
} }];
