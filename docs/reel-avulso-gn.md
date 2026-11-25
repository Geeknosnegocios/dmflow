# Reel avulso de Short GN

Use somente para Shorts GN liberados pelo Geek para @andreyogeek. Registre por ID de origem o OK editorial, a revisão visual do vídeo e da capa do ChatGPT Image, a verificação de duplicidade, a legenda final e o horário. A aprovação da interface registra o pacote exato com a chave DMFlow do proprietário.

1. Use o ID de 11 caracteres do Short. Converta a capa revisada em JPEG antes de registrar os hashes dos arquivos finais. Calcule o SHA-256 do MP4 e do JPEG.
2. No controlador Supabase `reels-batch-control`, use `sign-upload` com `path` e `contentType`. Para a data BRT do Reel, envie o MP4 para `reels/DATA/ID/reel-01-HASH12.mp4` e o JPEG para `reels/DATA/ID/reel-01-HASH12-cover.jpg`. `HASH12` são os primeiros 12 dígitos do hash do MP4. Use os tipos `video/mp4` e `image/jpeg` e upload sem sobrescrita. Confirme as URLs públicas no bucket `dmflow-content`.
3. Envie POST a `/api/v1/reels/approve-batch` com a chave DMFlow do proprietário no cabeçalho Bearer. O corpo abaixo ilustra o formato com valores fictícios.
4. Após o OK do lote, reenvie o mesmo corpo com `action: "schedule-single"` e `approvalId` igual a `approvals[0].id`. Use 10h, 14h ou 18h BRT, de segunda a sábado, com pelo menos 20 min de antecedência. A resposta confirma a linha lida da fila.
5. Confirme separadamente em `reels-batch-control` com `{"action":"verify-batch","date":"AAAA-MM-DD","sourceVideoId":"ID"}`. Deve haver uma linha de índice 1, no horário aprovado, com capa, Reel pendente e Story desabilitado. Repetições idênticas de uma entrada válida devolvem o mesmo ID. Em conflito, confira a origem e o horário antes de tentar novamente.

```json
{
  "action": "approve-single",
  "account": "andreyogeek",
  "channel": "GN",
  "sourceVideoId": "IDDOEXEMPLO",
  "date": "2026-12-03",
  "time": "10:00",
  "items": [{
    "idx": 1,
    "caption": "Legenda final revisada",
    "video_url": "URL_PUBLICA_DO_MP4",
    "cover_url": "URL_PUBLICA_DO_JPEG",
    "video_sha256": "sha256:HASH_DO_MP4",
    "cover_sha256": "sha256:HASH_DO_JPEG"
  }]
}
```

A via depende da implantação do app e da migração `20261125144000_allow_approved_single_gn_reel.sql`.
