#!/usr/bin/env bash
# Alertas de produção do PandaVip: site fora do ar e erros nas Functions.
#
# Rodar UMA vez no Cloud Shell (console.cloud.google.com → ícone >_ no topo),
# logado com a conta dona do projeto:
#   bash alertas-monitoramento.sh seu-email@gmail.com
#
# Cria:
#   - canal de e-mail para os avisos;
#   - teste a cada 5 min no painel (seu-projeto.web.app) e no site do app
#     (seu-projeto-app.web.app), de várias regiões do mundo;
#   - alerta quando um dos sites falha nos testes;
#   - alerta quando as Cloud Functions registram erro (no máx. 1 e-mail/hora).
set -euo pipefail

EMAIL="${1:?Uso: bash alertas-monitoramento.sh seu-email@gmail.com}"
PROJ=pandavip
gcloud config set project "$PROJ" >/dev/null
gcloud services enable monitoring.googleapis.com

CANAL=$(gcloud beta monitoring channels create \
  --display-name="PandaVip - e-mail" --type=email \
  --channel-labels=email_address="$EMAIL" --format='value(name)')

for HOST in seu-projeto.web.app seu-projeto-app.web.app; do
  gcloud monitoring uptime create "Site $HOST" \
    --resource-type=uptime-url \
    --resource-labels=host="$HOST",project_id="$PROJ" \
    --protocol=https --path=/ --period=5 --timeout=10
done

cat > /tmp/alerta-site.json <<EOF
{
  "displayName": "PandaVip - site fora do ar",
  "combiner": "OR",
  "conditions": [{
    "displayName": "Teste de disponibilidade falhando",
    "conditionThreshold": {
      "filter": "metric.type=\"monitoring.googleapis.com/uptime_check/check_passed\" AND resource.type=\"uptime_url\"",
      "aggregations": [{
        "alignmentPeriod": "1200s",
        "perSeriesAligner": "ALIGN_NEXT_OLDER",
        "crossSeriesReducer": "REDUCE_COUNT_FALSE",
        "groupByFields": ["resource.label.host"]
      }],
      "comparison": "COMPARISON_GT",
      "thresholdValue": 1,
      "duration": "60s",
      "trigger": { "count": 1 }
    }
  }],
  "notificationChannels": ["$CANAL"],
  "documentation": { "mimeType": "text/markdown", "content": "Um site do PandaVip não está respondendo. Abra o link do alerta e confira o Firebase Hosting." }
}
EOF

cat > /tmp/alerta-functions.json <<EOF
{
  "displayName": "PandaVip - erro nas Functions",
  "combiner": "OR",
  "conditions": [{
    "displayName": "Log de erro nas Cloud Functions",
    "conditionMatchedLog": {
      "filter": "severity>=ERROR AND (resource.type=\"cloud_run_revision\" OR resource.type=\"cloud_function\")"
    }
  }],
  "alertStrategy": {
    "notificationRateLimit": { "period": "3600s" },
    "autoClose": "1800s"
  },
  "notificationChannels": ["$CANAL"],
  "documentation": { "mimeType": "text/markdown", "content": "Uma Cloud Function do PandaVip registrou erro. Veja os logs pelo link do alerta." }
}
EOF

gcloud alpha monitoring policies create --policy-from-file=/tmp/alerta-site.json
gcloud alpha monitoring policies create --policy-from-file=/tmp/alerta-functions.json

echo
echo "Pronto. Confira em: https://console.cloud.google.com/monitoring/alerting?project=$PROJ"
