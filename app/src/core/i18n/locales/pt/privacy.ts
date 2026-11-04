// Português europeu: `privacy` (UX §5.18). Registo "você" implícito; Disciplina, Aula, apontamentos, ficheiro.
import type { Messages } from '../en';

export const privacy: Messages['privacy'] = {
  title: 'O que sai deste computador',
  intro: 'O Tramado não tem servidor nem conta. Isto é tudo o que alguma vez sai do seu computador, e quando.',
  columns: { when: 'Quando', what: 'O que é enviado', to: 'Para quem' },
  rows: {
    nothing: { when: 'Nada configurado', what: 'Nada. O Tramado não faz ligações por iniciativa própria.', to: '—' },
    sharing: { when: 'Partilha ou entra numa disciplina', what: 'Os ficheiros da disciplina, a conversa, o seu nome e o nome do seu computador, cifrados entre os computadores dos seus colegas. O identificador e o endereço IP do seu computador seguem para os servidores de descoberta e de retransmissão do Syncthing, e são anunciados na sua rede local, para que os colegas encontrem o seu computador. (Definições › Partilha › Só rede local desativa os servidores.)', to: 'Os computadores dos seus colegas; os servidores públicos de descoberta, retransmissão e STUN do Syncthing' },
    keyCheck: { when: 'Guardou uma chave do OpenRouter e a IA está ativada', what: 'A sua chave, para saber quantos pedidos gratuitos restam (quando o Tramado arranca, quando volta a ele passado algum tempo e quando testa a chave), e uma vez por dia um pedido da lista de modelos. Nenhuma pergunta nem conteúdo das disciplinas.', to: 'OpenRouter (EUA)' },
    ai: { when: 'Faz uma pergunta à IA (Perguntar, @IA, Explicar, respostas de exame, resumos)', what: 'A sua pergunta e os excertos necessários (com os nomes dos ficheiros e os tempos). Nunca pastas inteiras, apontamentos privados (a menos que inclua Os meus apontamentos), o histórico da conversa ou outras disciplinas.', to: 'OpenRouter (EUA) e a empresa que executa o modelo' },
    ocr: { when: 'Lê com a IA um exame ou documento digitalizado', what: 'As imagens das páginas', to: 'OpenRouter e o fornecedor do modelo' },
    cloudSpeech: { when: 'Transcreve com o OpenRouter', what: 'A gravação, em partes de até 30 segundos', to: 'OpenRouter e o fornecedor do modelo de voz' },
    customAi: { when: 'Usa outro serviço de IA (Definições › IA › Outro serviço)', what: 'O mesmo que para o OpenRouter acima: a sua pergunta e os excertos necessários, imagens de páginas para ler, gravações para transcrever.', to: 'O endereço que indicou (o seu computador, a sua rede ou o servidor da sua escola)' },
    model: { when: 'Transfere um modelo de voz', what: 'Um pedido de transferência', to: 'Hugging Face' },
    never: { when: 'Nunca', what: 'Sem conta, sem telemetria, sem estatísticas de utilização, sem relatórios de erros. Os relatórios de utilização do Syncthing estão desativados.', to: '—' },
  },
  log: {
    title: 'Atividade da IA neste computador',
    intro: 'Uma lista privada dos pedidos à IA feitos a partir deste computador. Nunca é enviada para lado nenhum.',
    columns: { time: 'Hora', class: 'Disciplina', action: 'Ação', model: 'Modelo', passages: 'Excertos enviados', requests: 'Pedidos' },
    actions: { ask: 'Perguntar', chat: '@IA na conversa', explain: 'Explicar', summary: 'Resumo', terms: 'Termos-chave', annotate: 'Anotar transcrição', studyNotes: 'Apontamentos de estudo', examExtract: 'Exame: encontrar perguntas', examOcr: 'Exame: ler páginas', examAnswer: 'Exame: responder', hint: 'Pista', deep: 'Resposta aprofundada', title: 'Título da aula', describe: 'Descrever imagem', docOcr: 'Ler uma digitalização', cloudSpeech: 'Transcrição na nuvem', keyCheck: 'Verificação da chave', catalog: 'Lista de modelos' },
    clear: 'Limpar o registo',
    empty: 'Ainda não houve pedidos à IA.',
    clearConfirm: { title: 'Limpar o registo de atividade da IA?', body: 'A lista de pedidos à IA feitos neste computador é removida. Nada mais muda: as suas respostas, apontamentos e disciplinas ficam.' },
    cleared: 'O registo de atividade da IA está vazio.',
  },
  where: { title: 'Onde estão os seus dados', classes: 'Abrir a pasta das disciplinas', private: 'Abrir a pasta dos dados privados', models: 'Abrir a pasta dos modelos', cache: 'Abrir a pasta da cache' },
  whereBody: 'As suas disciplinas são pastas comuns, no sítio onde escolheu guardá-las (Definições › Armazenamento). Os dados privados do Tramado (os seus apontamentos, destaques, prática e o registo de atividade da IA), os modelos de voz e a cache ficam nas pastas do próprio Tramado neste computador e nunca são partilhados.',
};
