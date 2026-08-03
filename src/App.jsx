import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  carregarPerfis, salvarPerfis, carregarPolitica, salvarPolitica,
  carregarDetectorNitidez, salvarDetectorNitidez,
} from './data/perfis.js'
import { POLITICA_PADRAO } from './core/regras.js'
import { analisar } from './core/analise.js'
import { listar, registrar, marcarRiscoAceito } from './store/historico.js'
import PecaForm from './components/PecaForm.jsx'
import Upload from './components/Upload.jsx'
import Resultado from './components/Resultado.jsx'
import Gabarito from './components/Gabarito.jsx'
import PainelPerfis from './components/PainelPerfis.jsx'
import Historico from './components/Historico.jsx'

export default function App() {
  const [perfis, setPerfis] = useState(carregarPerfis)
  const [perfilId, setPerfilId] = useState('lona-parede')
  const [peca, setPeca] = useState({ larguraCm: 200, alturaCm: 290 })
  const [escalaFator, setEscalaFator] = useState(1)
  const [politica, setPolitica] = useState(() => carregarPolitica(POLITICA_PADRAO))
  const [detectorNitidez, setDetectorNitidez] = useState(carregarDetectorNitidez)

  const [arquivo, setArquivo] = useState(null)
  const [analisando, setAnalisando] = useState(false)
  const [resultado, setResultado] = useState(null)
  const [erro, setErro] = useState(null)
  const [registroAtual, setRegistroAtual] = useState(null)

  const [modoTecnico, setModoTecnico] = useState(false)
  const [registros, setRegistros] = useState(listar)

  const perfil = useMemo(
    () => perfis.find((p) => p.id === perfilId) || perfis[0],
    [perfis, perfilId],
  )

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

  const rodar = useCallback(async (arq) => {
    setAnalisando(true)
    setErro(null)
    setResultado(null)
    setRegistroAtual(null)
    try {
      const r = await analisar(arq, peca, perfil, { escalaFator, politica, detectorNitidez })
      setResultado(r)
      const reg = registrar({
        hash: r.medidas.arquivo?.hash,
        nome: r.medidas.arquivo?.nome,
        veredicto: r.veredicto,
        peca: `${perfil.nome} ${peca.larguraCm}×${peca.alturaCm} cm`,
        dpi: r.resolucao?.dpi ?? null,
      })
      setRegistroAtual(reg)
      setRegistros(listar())
    } catch (e) {
      console.error(e)
      setErro(e?.message || 'Não foi possível ler este arquivo.')
    } finally {
      setAnalisando(false)
    }
  }, [peca, perfil, escalaFator, politica, detectorNitidez])

  // Trocar a peça ou a escala muda o veredicto — reanalisa sem novo upload.
  useEffect(() => {
    if (arquivo && !analisando) rodar(arquivo)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perfilId, peca.larguraCm, peca.alturaCm, escalaFator, politica, detectorNitidez])

  const receberArquivo = (arq) => {
    setArquivo(arq)
    rodar(arq)
  }

  const aceitarRisco = () => {
    if (!registroAtual) return
    setRegistros(marcarRiscoAceito(registroAtual.id))
    setRegistroAtual({ ...registroAtual, riscoAceito: { em: new Date().toISOString() } })
  }

  return (
    <div className="app">
      <header className="topo">
        <div>
          <h1>Aprovação de arte</h1>
          <p>Confira se a arte está pronta para impressão antes de enviá-la.</p>
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
          {modoTecnico && <Historico registros={registros} onMudar={setRegistros} />}
        </div>

        <div className="coluna">
          <Upload onArquivo={receberArquivo} analisando={analisando} nomeAtual={arquivo?.name} />

          {erro && (
            <div className="cartao erro">
              <strong>Não foi possível analisar este arquivo</strong>
              <p>{erro}</p>
              <p className="acao">→ Tente exportar a arte em PDF, JPG ou PNG e enviar novamente.</p>
            </div>
          )}

          {resultado && (
            <Resultado
              resultado={resultado}
              modoTecnico={modoTecnico}
              onAceitarRisco={aceitarRisco}
              riscoAceito={registroAtual?.riscoAceito}
            />
          )}

          {!resultado && !erro && !analisando && (
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
        Tudo roda no seu navegador — nenhum arquivo é enviado para servidor algum.
      </footer>
    </div>
  )
}
