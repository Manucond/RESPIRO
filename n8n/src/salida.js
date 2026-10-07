// Salida: reparte los mensajes de Telegram (y avisos a admins) en elementos.
const tg = Array.isArray($json.tg) ? $json.tg : [];
const out = tg.map((t) => ({ json: { tg: t } }));
if ($json.admin_txt) {
  for (const chat of $json.admins || []) out.push({ json: { tg: tgTexto(chat, esc($json.admin_txt)) } });
}
return out;
