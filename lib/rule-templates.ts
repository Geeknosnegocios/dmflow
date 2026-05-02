import type { TriggerType, MatchMode, DmButton } from "@/types/db";

export type RuleTemplate = {
  id: string;
  name: string;
  description: string;
  icon: string; // lucide-react icon name
  trigger_type: TriggerType;
  keyword: string | null;
  match_mode: MatchMode;
  public_reply: string | null;
  dm_message: string;
  dm_buttons: DmButton[];
  followup_delay_hours?: number | null;
  followup_message?: string | null;
};

export const RULE_TEMPLATES: RuleTemplate[] = [
  {
    id: "lancamento",
    name: "Lançamento de produto",
    description: "Comentário vira pre-lista VIP. Envia link da página + follow-up em 2 dias.",
    icon: "Rocket",
    trigger_type: "comment",
    keyword: "QUERO",
    match_mode: "contains",
    public_reply: "Mandei no direct 👇",
    dm_message:
      "Opa {first_name}! Vi que você quer {PRODUTO}. Aqui está o link da pré-lista VIP — quem entra agora ganha desconto no lançamento:",
    dm_buttons: [{ title: "Entrar na lista", url: "https://geek-os.geekacademy.site" }],
    followup_delay_hours: 48,
    followup_message:
      "Oi {first_name}, ainda tá aberto o desconto do lançamento. Se quiser garantir, é por aqui:",
  },
  {
    id: "black-friday",
    name: "Black Friday",
    description: "Keyword 'CUPOM' responde com código e link direto do checkout.",
    icon: "Tag",
    trigger_type: "comment",
    keyword: "CUPOM",
    match_mode: "contains",
    public_reply: "Te mandei o cupom no direct 🔥",
    dm_message:
      "Boa {first_name}! Teu cupom: BLACK30 (válido 24h). Aplica direto no checkout:",
    dm_buttons: [
      { title: "Ativar cupom", url: "https://geek-os.geekacademy.site/?coupon=BLACK30" },
    ],
    followup_delay_hours: 12,
    followup_message: "Cupom BLACK30 expira em 12h ⏰. Abre rápido:",
  },
  {
    id: "lead-magnet",
    name: "Lead magnet (ebook grátis)",
    description: "Comentou a palavra-chave? Entrega o ebook + adiciona à lista.",
    icon: "BookOpen",
    trigger_type: "comment",
    keyword: "EBOOK",
    match_mode: "contains",
    public_reply: "Te mandei no direct 📕",
    dm_message:
      "Opa! Aqui está o ebook que prometi, {first_name}. Aproveita que é grátis:",
    dm_buttons: [{ title: "Baixar ebook", url: "https://geek-os.geekacademy.site" }],
  },
  {
    id: "consulta",
    name: "Consulta gratuita",
    description: "Comentário agenda slot. Responde com link do Calendly.",
    icon: "Calendar",
    trigger_type: "comment",
    keyword: "CONSULTA",
    match_mode: "contains",
    public_reply: "Agendamento liberado 👇 (direct)",
    dm_message:
      "Boa {first_name}! Agenda a consulta no link abaixo — só tem 5 slots essa semana:",
    dm_buttons: [{ title: "Agendar", url: "https://calendly.com/seu-usuario" }],
  },
  {
    id: "webinar",
    name: "Inscrição em webinar",
    description: "Keyword dispara inscrição + lembrete 1 dia antes.",
    icon: "Video",
    trigger_type: "comment",
    keyword: "AULA",
    match_mode: "contains",
    public_reply: "Inscrição no direct 🎥",
    dm_message: "Te garanti a vaga na aula, {first_name}. Adiciona na agenda:",
    dm_buttons: [{ title: "Confirmar inscrição", url: "https://geek-os.geekacademy.site" }],
    followup_delay_hours: 24,
    followup_message:
      "Oi {first_name}, amanhã começa a aula. Não perde — confirma aqui:",
  },
  {
    id: "welcome-dm",
    name: "Boas-vindas (primeira DM)",
    description: "Qualquer pessoa que mandar primeira DM recebe apresentação.",
    icon: "Hand",
    trigger_type: "first_dm",
    keyword: null,
    match_mode: "any",
    public_reply: null,
    dm_message:
      "Opa {first_name} 👋 Valeu por chegar. Aqui é o Andrey. Se quer usar IA pra empreender, dá uma olhada:",
    dm_buttons: [
      { title: "YouTube GI", url: "https://www.youtube.com/@Geekinteligencia" },
      { title: "Entrar no Network", url: "https://capturas.vercel.app?src=ig-dm" },
    ],
  },
  {
    id: "story-reply",
    name: "Resposta a story",
    description: "Qualquer resposta a um story específico dispara DM.",
    icon: "Camera",
    trigger_type: "story_reply",
    keyword: null,
    match_mode: "any",
    public_reply: null,
    dm_message:
      "Valeu por responder, {first_name}! Como prometi no story, aqui está o material:",
    dm_buttons: [{ title: "Acessar", url: "https://geek-os.geekacademy.site" }],
  },
];
