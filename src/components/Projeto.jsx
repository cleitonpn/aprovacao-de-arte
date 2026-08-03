import { useEffect, useMemo, useState } from 'react'
import { carregarPerfis, carregarPolitica, carregarDetectorNitidez } from '../data/perfis.js'
import { POLITICA_PADRAO, especificacao } from '../core/regras.js'
import { cadastroDoProjeto, pecaNova, perfilPorTexto } from '../data/projeto.js'
import { carregarProjetoPublico, marcarEntrega } from '../services/projetos.js'
import { usarAnalise } from '../store/usarAnalise.js'
import Upload from './Upload.jsx'
import Resultado from './Resultado.jsx'
import Gabarito from './Gabarito.jsx'
import Avulsos from './Avulsos.jsx'

// A tela do cliente quando o projeto está cadastrado.
//
// Aqui está o ganho principal da inversão: o cliente NÃO digita medida. Ela
// vem do projeto do stand, feita por quem a conhece. Antes, uma medida errada
// digitada por ele fazia a ferramenta aprovar com confiança uma arte errada —
// o único jeito de ela ser pior do que não existir.
//
// Continua sem login, de propósito: o token do endereço é a credencial. Quem
// monta a arte quase nunca é o e-mail cadastrado, é a agência do cliente, e
// uma senha por pessoa deixaria justamente ela de fora.

const fmt = (n) => new Intl.NumberFormat('pt-BR').format(Math.round(n))

export default function Projeto({ token }) {
  // Lidos uma vez: são leituras de localStorage e não mudam nesta tela — o
  // painel técnico que os edita só existe na ferramenta aberta.
  const perfis = useMemo(carregarPerfis, [])
  const politica = useMemo(() => carregarPolitica(POLITICA_PADRAO), [])
  const detectorNitidez = useMemo(carregarDetectorNitidez, [])

  const [projeto, setProjeto] = useState(null)
  const [estado, setEstado] = useState('carregando') // carregando | pronto | ausente | erro
  const [erro, setErro] = useState(null)
  const [pecaAtiva, setPecaAtiva] = useState(null)
  const [entregas, setEntregas] = useState({})
  const [extra, setExtra] = useState(null)

  useEffect(() => {
    let vivo = true
    setEstado('carregando')
    carregarProjetoPublico(token)
      .then((p) => {
        if (!vivo) return
        if (!p) { setEstado('ausente'); return }
        setProjeto(p)
        setEntregas(p.entregas || {})
        setEstado('pronto')
      })
      .catch((e) => {
        if (!vivo) return
        console.error(e)
        setErro(e?.message || 'Não foi possível abrir este projeto.')
        setEstado('erro')
      })
    return () => { vivo = false }
  }, [token])

  const cadastro = useMemo(() => (projeto ? cadastroDoProjeto(projeto) : null), [projeto])

  const registrarEntrega = async (peca, recibo) => {
    setEntregas((atual) => ({
      ...atual,
      [peca.id]: {
        protocolo: recibo.protocolo,
        veredicto: recibo.veredicto,
        riscoAceito: Boolean(recibo.riscoAceito),
        em: new Date().toISOString(),
      },
    }))
    if (peca.id.startsWith('extra_')) return // peça fora da lista não entra no checklist
    await marcarEntrega(projeto.token, peca.id, {
      protocolo: recibo.protocolo,
      veredicto: recibo.veredicto,
      riscoAceito: recibo.riscoAceito,
      arquivo: recibo.nomeNoStorage,
    })
  }

  if (estado === 'carregando') {
    return <div className="cartao"><p className="ajuda">Abrindo o projeto do seu stand…</p></div>
  }

  if (estado === 'ausente') {
    return (
      <div className="cartao">
        <h2>Link não encontrado</h2>
        <p className="ajuda">
          Este link não corresponde a nenhum projeto. Ele pode ter sido digitado
          pela metade, ou o projeto pode ter sido removido. Confira o endereço
          com quem enviou.
        </p>
        <p className="nota">
          Se você precisa mandar uma arte agora e não tem o link certo, use a{' '}
          <a href="#/">ferramenta aberta</a> — nela você informa as medidas
          manualmente.
        </p>
      </div>
    )
  }

  if (estado === 'erro') {
    return (
      <div className="cartao erro">
        <strong>Não foi possível abrir este projeto</strong>
        <p>{erro}</p>
      </div>
    )
  }

  const pecas = projeto.pecas || []
  const entregues = pecas.filter((p) => entregas[p.id]).length
  const ativa = pecaAtiva || extra

  return (
    <>
      <div className="cartao projeto-cabecalho">
        <h2>{projeto.stand}</h2>
        <p className="ajuda">
          {projeto.feira}
          {projeto.localizacao && ` · ${projeto.localizacao}`}
        </p>
        <div className="progresso-peças">
          <div className="barra">
            <div style={{ width: `${pecas.length ? (entregues / pecas.length) * 100 : 0}%` }} />
          </div>
          <p className="ajuda">
            {entregues === pecas.length && pecas.length > 0
              ? '✓ Todas as artes deste stand já foram enviadas.'
              : `${entregues} de ${pecas.length} artes enviadas.`}
          </p>
        </div>
        <p className="nota">
          As medidas de cada peça já vêm do projeto do seu stand — você não
          precisa informar tamanho nenhum. A conferência da arte acontece no seu
          próprio navegador; o arquivo só sai do seu computador quando você
          clicar em enviar.
        </p>
      </div>

      {!ativa && (
        <>
          <div className="cartao">
            <h3>Peças deste stand</h3>
            <ul className="pecas-cartoes">
              {pecas.map((peca) => (
                <CartaoPeca
                  key={peca.id}
                  peca={peca}
                  perfis={perfis}
                  politica={politica}
                  entrega={entregas[peca.id]}
                  onEscolher={() => setPecaAtiva(peca)}
                />
              ))}
            </ul>
            <PecaForaDaLista onCriar={(p) => setExtra(p)} />
          </div>

          {projeto.aceitaAvulsos !== false && <Avulsos projeto={projeto} cadastro={cadastro} />}
        </>
      )}

      {ativa && (
        <PainelDaPeca
          peca={ativa}
          projeto={projeto}
          cadastro={cadastro}
          perfis={perfis}
          politica={politica}
          detectorNitidez={detectorNitidez}
          entrega={entregas[ativa.id]}
          onVoltar={() => { setPecaAtiva(null); setExtra(null) }}
          onEnviado={(recibo) => registrarEntrega(ativa, recibo)}
        />
      )}
    </>
  )
}

function CartaoPeca({ peca, perfis, politica, entrega, onEscolher }) {
  const perfil = perfis.find((p) => p.id === peca.perfilId) || perfis[0]
  const spec = especificacao(peca, perfil, politica)

  return (
    <li className={`peca-cartao ${entrega ? 'entregue' : ''}`}>
      <div>
        <strong>{peca.rotulo}</strong>
        <p className="dica-campo">
          {fmt(peca.larguraCm)} × {fmt(peca.alturaCm)} cm · com sangria{' '}
          {fmt(spec.comSangria.larguraCm)} × {fmt(spec.comSangria.alturaCm)} cm
          {peca.escalaFator > 1 && ` · pode vir em escala 1:${peca.escalaFator}`}
        </p>
        {entrega
          ? (
            <p className="dica-campo entregue-em">
              ✓ Enviada em {new Date(entrega.em).toLocaleString('pt-BR')} · protocolo {entrega.protocolo}
              {entrega.veredicto === 'ressalva' && ' · com ressalva'}
            </p>
          )
          : <p className="dica-campo">Mínimo {fmt(spec.minimo.largura)} × {fmt(spec.minimo.altura)} px ({spec.minimo.dpi} dpi)</p>}
      </div>
      <button className={`btn ${entrega ? 'btn-ghost' : ''}`} onClick={onEscolher}>
        {entrega ? 'Enviar outra versão' : 'Enviar arte'}
      </button>
    </li>
  )
}

/**
 * Saída para a peça que não estava no projeto.
 *
 * Sempre aparece uma. Sem esta porta, o cliente trava e liga para o time — que
 * é exatamente o telefonema que a ferramenta existe para evitar. Aqui ele
 * volta a informar a medida à mão, como no fluxo aberto, e o envio chega
 * marcado como fora da lista para o time conferir.
 */
function PecaForaDaLista({ onCriar }) {
  const [aberto, setAberto] = useState(false)
  const [rotulo, setRotulo] = useState('')
  const [largura, setLargura] = useState('')
  const [altura, setAltura] = useState('')

  const valido = rotulo.trim().length > 1 && Number(largura) > 0 && Number(altura) > 0

  if (!aberto) {
    return (
      <button className="link" onClick={() => setAberto(true)}>
        Preciso enviar uma peça que não está nesta lista
      </button>
    )
  }

  return (
    <div className="peca-editor">
      <p className="ajuda">
        Informe a peça e as medidas finais dela. Como esta não veio do projeto,
        confira o tamanho com o seu contato antes de enviar.
      </p>
      <label className="campo">
        <span>O que é a peça</span>
        <input type="text" value={rotulo} onChange={(e) => setRotulo(e.target.value)} placeholder="Adesivo da vitrine" />
      </label>
      <div className="linha">
        <label className="campo">
          <span>Largura (cm)</span>
          <input type="number" min="1" step="0.1" value={largura} onChange={(e) => setLargura(e.target.value)} />
        </label>
        <label className="campo">
          <span>Altura (cm)</span>
          <input type="number" min="1" step="0.1" value={altura} onChange={(e) => setAltura(e.target.value)} />
        </label>
      </div>
      <div className="acoes">
        <button
          className="btn"
          disabled={!valido}
          onClick={() => onCriar(pecaNova({
            id: `extra_${Date.now()}`,
            rotulo: rotulo.trim(),
            perfilId: perfilPorTexto(rotulo),
            larguraCm: Number(largura),
            alturaCm: Number(altura),
          }))}
        >
          Continuar
        </button>
        <button className="btn btn-ghost" onClick={() => setAberto(false)}>Cancelar</button>
      </div>
    </div>
  )
}

function PainelDaPeca({ peca, projeto, cadastro, perfis, politica, detectorNitidez, entrega, onVoltar, onEnviado }) {
  const perfil = perfis.find((p) => p.id === peca.perfilId) || perfis[0]
  const alvo = { larguraCm: peca.larguraCm, alturaCm: peca.alturaCm }

  // A escala continua sendo escolha de quem montou o arquivo: ela descreve o
  // ARQUIVO, não a peça. O projeto só sugere a escala aceita.
  const [escalaFator, setEscalaFator] = useState(peca.escalaFator || 1)

  const analise = usarAnalise({ peca: alvo, perfil, escalaFator, politica, detectorNitidez })
  const spec = especificacao(alvo, perfil, politica)

  return (
    <>
      <div className="cartao">
        <div className="admin-topo">
          <div>
            <h2>{peca.rotulo}</h2>
            <p className="ajuda">{perfil.nome} · {fmt(peca.larguraCm)} × {fmt(peca.alturaCm)} cm</p>
          </div>
          <button className="btn btn-ghost" onClick={onVoltar}>← Todas as peças</button>
        </div>

        {entrega && (
          <p className="nota">
            Esta peça já foi enviada em {new Date(entrega.em).toLocaleString('pt-BR')}.
            Enviar de novo cria um registro novo — o time vai receber as duas
            versões e usar a mais recente.
          </p>
        )}

        <div className="spec">
          <div className="spec-titulo">O que o arquivo precisa ter</div>
          <dl>
            <div>
              <dt>Tamanho final</dt>
              <dd>{fmt(peca.larguraCm)} × {fmt(peca.alturaCm)} cm</dd>
            </div>
            <div>
              <dt>Com sangria ({spec.sangriaMm} mm por lado)</dt>
              <dd>{fmt(spec.comSangria.larguraCm)} × {fmt(spec.comSangria.alturaCm)} cm</dd>
            </div>
            <div>
              <dt>Margem de segurança</dt>
              <dd>{perfil.margemMm} mm</dd>
            </div>
            <div className="destaque">
              <dt>Mínimo com sangria ({spec.minimo.dpi} dpi)</dt>
              <dd>{fmt(spec.minimo.largura)} × {fmt(spec.minimo.altura)} px</dd>
            </div>
            <div className="destaque">
              <dt>Ideal com sangria ({spec.ideal.dpi} dpi)</dt>
              <dd>{fmt(spec.ideal.largura)} × {fmt(spec.ideal.altura)} px</dd>
            </div>
          </dl>
        </div>

        <label className="campo">
          <span>Em que escala a arte foi montada</span>
          <select value={escalaFator} onChange={(e) => setEscalaFator(Number(e.target.value))}>
            <option value={1}>1:1 — tamanho real</option>
            <option value={2}>1:2 — metade do tamanho</option>
            <option value={4}>1:4 — um quarto</option>
            <option value={10}>1:10 — um décimo</option>
          </select>
        </label>
        <p className="nota">
          Montar a arte reduzida é praxe no grande formato. Informar a escala
          evita que um arquivo correto seja reprovado por engano.
        </p>

        <Gabarito peca={alvo} perfil={perfil} escalaFator={escalaFator} politica={politica} />
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
            onAceitarRisco={analise.aceitarRisco}
            riscoAceito={analise.riscoAceito}
            arquivo={analise.arquivo}
            cadastro={cadastro}
            projeto={{ token: projeto.token, pecaId: peca.id.startsWith('extra_') ? null : peca.id, pecaRotulo: peca.rotulo }}
            onEnviado={onEnviado}
          />
        )}
      </div>
    </>
  )
}
