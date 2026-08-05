import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  carregarPerfis, salvarPerfis, carregarPolitica, salvarPolitica,
  carregarDetectorNitidez, salvarDetectorNitidez,
} from './data/perfis.js'
import { POLITICA_PADRAO } from './core/regras.js'
import { usarAnalise } from './store/usarAnalise.js'
import PecaForm from './components/PecaForm.jsx'
import Upload from './components/Upload.jsx'
import Resultado from './components/Resultado.jsx'
import Gabarito from './components/Gabarito.jsx'
import PainelPerfis from './components/PainelPerfis.jsx'
import Historico from './components/Historico.jsx'
import Cadastro from './components/Cadastro.jsx'
import Acesso from './components/Acesso.jsx'
import Admin from './components/Admin.jsx'
import Projetos from './components/Projetos.jsx'
import Visao from './components/Visao.jsx'
import Usuarios from './components/Usuarios.jsx'
import Projeto from './components/Projeto.jsx'
import { usarSessao } from './services/sessao.js'
import { abasDe, telaInicial, pode } from './core/permissoes.js'
import { usarAvisos } from './store/usarAvisos.js'
import * as cadastroStore from './data/cadastro.js'

// Rota por hash, sem biblioteca de roteamento: são cinco telas e nenhuma delas
// precisa de rota aninhada, parâmetro de busca ou histórico elaborado.
//
//   #/            ferramenta aberta (cliente informa as medidas)
//   #/p/TOKEN     projeto cadastrado (medidas vêm do time) — sem login
//   #/visao       a feira inteira numa tela  ⎫
//   #/admin       artes recebidas            ⎪
//   #/projetos    cadastro de projetos       ⎬ time interno, com login
//   #/projetos/FEIRA/TOKEN  a ficha de um stand direto  ⎪
//   #/analistas   quem tem acesso            ⎭
function usarRota() {
  const ler = () => (typeof window === 'undefined' ? '' : window.location.hash.replace(/^#\/?/, ''))
  const [caminho, setCaminho] = useState(ler)
  useEffect(() => {
    const aoMudar = () => setCaminho(ler())
    window.addEventListener('hashchange', aoMudar)
    return () => window.removeEventListener('hashchange', aoMudar)
  }, [])

  const partes = caminho.split('/').filter(Boolean)
  if (partes[0] === 'p' && partes[1]) return { tela: 'projeto', token: partes[1] }
  // A visão geral aponta para stands específicos, e a ficha vive dentro da
  // tela de projetos — que só carrega UMA feira por vez. Daí a feira vir junto
  // no endereço: sem ela, o atalho abriria a tela certa com a feira errada e o
  // stand não estaria lá.
  if (partes[0] === 'projetos' && partes[1] && partes[2]) {
    return { tela: 'projetos', feiraId: partes[1], token: partes[2] }
  }
  if (['visao', 'admin', 'projetos', 'analistas'].includes(partes[0])) return { tela: partes[0] }
  return { tela: 'ferramenta' }
}

export default function App() {
  const rota = usarRota()

  if (rota.tela === 'projeto') {
    // Largura cheia, e não a coluna estreita de antes: no monitor do escritório
    // a tela ficava espremida no meio da página, com as peças uma embaixo da
    // outra e rolagem à toa. O conteúdo se organiza sozinho — a lista vira
    // grade no PC e empilha no celular.
    return (
      <div className="app">
        <header className="topo">
          <div>
            <h1>Envio de artes</h1>
            <p>Confira e envie as artes do seu stand.</p>
          </div>
        </header>
        <Projeto token={rota.token} />
        <footer className="rodape">
          A análise roda no seu navegador. O arquivo só é enviado quando você
          clicar em <strong>Enviar arte para produção</strong>.
        </footer>
      </div>
    )
  }

  if (rota.tela !== 'ferramenta') return <PainelInterno rota={rota} />

  return <Ferramenta />
}

function PainelInterno({ rota }) {
  const { tela } = rota
  const sessao = usarSessao()
  const abas = abasDe(sessao.acesso)
  const avisos = usarAvisos(sessao)

  // Entrar por um endereço que o papel não alcança não pode virar tela em
  // branco nem erro: manda para a primeira tela que a pessoa realmente usa.
  const inicial = telaInicial(sessao.acesso)
  const permitida = abas.some((a) => a.id === tela)
  useEffect(() => {
    if (sessao.liberado && !permitida && inicial) window.location.hash = `#/${inicial}`
  }, [sessao.liberado, permitida, inicial])

  return (
    <div className="app">
      <header className="topo">
        <div>
          <h1>Aprovação de arte</h1>
          <p>Painel do time de comunicação visual.</p>
        </div>
        {sessao.liberado && (
          <div className="sessao-topo">
            <span className="dica-campo">{sessao.usuario?.email}</span>
            <button className="btn btn-ghost" onClick={sessao.sair}>Sair</button>
          </div>
        )}
      </header>

      {sessao.liberado && (
        <nav className="abas">
          {abas.map((t) => (
            <a key={t.id} href={`#/${t.id}`} className={t.id === tela ? 'ativa' : ''}>
              {t.rotulo}
              {avisos[t.id] > 0 && <span className="badge">{avisos[t.id] > 99 ? '99+' : avisos[t.id]}</span>}
            </a>
          ))}
          <span className="papel-atual">{sessao.acesso?.rotulo}</span>
          <a href="#/" className="fora">Abrir a ferramenta</a>
        </nav>
      )}

      <div className="coluna">
        <Acesso sessao={sessao}>
          {permitida && tela === 'visao' && pode(sessao.acesso, 'verPainel') && <Visao sessao={sessao} />}
          {permitida && tela === 'admin' && pode(sessao.acesso, 'verArtes') && <Admin sessao={sessao} />}
          {permitida && tela === 'projetos' && (
            <Projetos sessao={sessao} feiraInicial={rota.feiraId} tokenInicial={rota.token} />
          )}
          {permitida && tela === 'analistas' && pode(sessao.acesso, 'gerenciarAnalistas') && <Usuarios sessao={sessao} />}
        </Acesso>
      </div>
    </div>
  )
}

/**
 * A ferramenta aberta: o cliente informa as medidas.
 *
 * Continua existindo depois do cadastro de projetos, e não por acomodação. No
 * começo de uma feira nem todo stand está cadastrado, e nenhum cliente pode
 * ficar sem conseguir mandar arte por causa disso. Também serve ao próprio
 * time, que confere arte solta o dia inteiro.
 */
function Ferramenta() {
  const [cadastro, setCadastro] = useState(cadastroStore.carregar)
  const [editandoCadastro, setEditandoCadastro] = useState(false)
  const [perfis, setPerfis] = useState(carregarPerfis)
  const [perfilId, setPerfilId] = useState('lona-parede')
  const [peca, setPeca] = useState({ larguraCm: 200, alturaCm: 290 })
  const [escalaFator, setEscalaFator] = useState(1)
  const [politica, setPolitica] = useState(() => carregarPolitica(POLITICA_PADRAO))
  const [detectorNitidez, setDetectorNitidez] = useState(carregarDetectorNitidez)
  const [modoTecnico, setModoTecnico] = useState(false)

  const perfil = useMemo(
    () => perfis.find((p) => p.id === perfilId) || perfis[0],
    [perfis, perfilId],
  )

  const analise = usarAnalise({ peca, perfil, escalaFator, politica, detectorNitidez })

  const guardarPerfis = useCallback((novos) => {
    setPerfis(novos)
    salvarPerfis(novos)
  }, [])

  const guardarPolitica = useCallback((mudanca) => {
    setPolitica((atual) => {
      const nova = { ...atual, ...mudanca }
      salvarPolitica(nova)
      return nova
    })
  }, [])

  const guardarDetector = useCallback((ligado) => {
    setDetectorNitidez(ligado)
    salvarDetectorNitidez(ligado)
  }, [])

  const atualizar = useCallback((mudanca) => {
    if ('perfilId' in mudanca) setPerfilId(mudanca.perfilId)
    if ('peca' in mudanca) setPeca(mudanca.peca)
    if ('escalaFator' in mudanca) setEscalaFator(mudanca.escalaFator)
  }, [])

  const confirmarCadastro = (dados) => {
    cadastroStore.salvar(dados)
    setCadastro(dados)
    setEditandoCadastro(false)
  }

  if (!cadastro) {
    return (
      <div className="app estreito">
        <header className="topo">
          <div>
            <h1>Aprovação de arte</h1>
            <p>Confira se a arte está pronta para impressão antes de enviá-la.</p>
          </div>
        </header>
        <Cadastro onConfirmar={confirmarCadastro} />
      </div>
    )
  }

  if (editandoCadastro) {
    return (
      <div className="app estreito">
        <header className="topo">
          <div><h1>Seus dados</h1></div>
        </header>
        <Cadastro
          inicial={cadastro}
          onConfirmar={confirmarCadastro}
          onCancelar={() => setEditandoCadastro(false)}
        />
      </div>
    )
  }

  return (
    <div className="app">
      <header className="topo">
        <div>
          <h1>Aprovação de arte</h1>
          <p>
            {cadastro.stand} · {cadastro.feira}{' '}
            <button className="link" onClick={() => setEditandoCadastro(true)}>alterar</button>
          </p>
        </div>
        <label className="alternador">
          <input type="checkbox" checked={modoTecnico} onChange={(e) => setModoTecnico(e.target.checked)} />
          <span>Modo técnico</span>
        </label>
      </header>

      <div className="colunas">
        <div className="coluna">
          <PecaForm
            perfis={perfis}
            perfilId={perfilId}
            peca={peca}
            escalaFator={escalaFator}
            politica={politica}
            onChange={atualizar}
          />
          <Gabarito peca={peca} perfil={perfil} escalaFator={escalaFator} politica={politica} />
          {modoTecnico && (
            <PainelPerfis
              perfis={perfis}
              onSalvar={guardarPerfis}
              politica={politica}
              onPolitica={guardarPolitica}
              detectorNitidez={detectorNitidez}
              onDetector={guardarDetector}
            />
          )}
          {modoTecnico && <Historico registros={analise.registros} onMudar={analise.setRegistros} />}
        </div>

        <div className="coluna">
          <Upload onArquivo={analise.receberArquivo} analisando={analise.analisando} nomeAtual={analise.arquivo?.name} />

          {analise.erro && (
            <div className="cartao erro">
              <strong>Não foi possível analisar este arquivo</strong>
              <p>{analise.erro}</p>
              <p className="acao">→ Tente exportar a arte em PDF, JPG ou PNG e enviar novamente.</p>
            </div>
          )}

          {analise.resultado && (
            <Resultado
              resultado={analise.resultado}
              modoTecnico={modoTecnico}
              onAceitarRisco={analise.aceitarRisco}
              riscoAceito={analise.riscoAceito}
              arquivo={analise.arquivo}
              cadastro={cadastro}
            />
          )}

          {!analise.resultado && !analise.erro && !analise.analisando && (
            <div className="cartao vazio">
              <h3>O que é verificado</h3>
              <ul>
                <li><strong>Resolução no tamanho impresso</strong> — a conta que realmente importa, não o dpi que o arquivo declara.</li>
                <li><strong>Nitidez real</strong> — descobre imagem pequena ampliada no editor, que engana o metadado mas não a impressão.</li>
                <li><strong>Proporção</strong> — quanto da arte seria cortado ao encaixar na peça.</li>
                <li><strong>Compressão, cor e transparência</strong> — o que costuma sair diferente do que se vê na tela.</li>
                <li><strong>Margem de segurança</strong> — conteúdo perto demais da borda, que a estrutura come.</li>
                <li><strong>PDF</strong> — vetor ou imagem, fontes incorporadas, resolução das fotos coladas dentro.</li>
              </ul>
              <p className="nota">
                A análise não julga o conteúdo: se o logo é a versão certa, se a cor
                da marca está correta ou se há erro de digitação continua sendo
                trabalho de quem revisa.
              </p>
            </div>
          )}
        </div>
      </div>

      <footer className="rodape">
        A análise roda no seu navegador. O arquivo só é enviado quando você
        clicar em <strong>Enviar arte para produção</strong>.
      </footer>
    </div>
  )
}
