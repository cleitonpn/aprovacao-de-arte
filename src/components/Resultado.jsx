import { useState } from 'react'
import { ROTULO_VEREDICTO, especificacao } from '../core/regras.js'
import { mensagemParaDesigner, laudoJson } from '../core/mensagem.js'
import Simulador from './Simulador.jsx'
import Envio from './Envio.jsx'

const ICONE = { ok: '✓', info: 'i', ressalva: '!', bloqueante: '×' }
const ORDEM = { bloqueante: 0, ressalva: 1, info: 2, ok: 3 }
const fmt = (n) => new Intl.NumberFormat('pt-BR').format(Math.round(n))

const RESUMO = {
  aprovado: 'A arte atende às exigências desta peça. Pode seguir para impressão.',
  ressalva: 'A arte imprime, mas com perda perceptível. Veja os pontos abaixo e decida se aceita seguir assim.',
  reprovado: 'A arte não pode ser impressa nesta peça sem os ajustes abaixo.',
}

function baixar(nome, conteudo, tipo) {
  const blob = new Blob([conteudo], { type: tipo })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nome
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

export default function Resultado({ resultado, modoTecnico, onAceitarRisco, riscoAceito, arquivo, cadastro, projeto, onEnviado }) {
  const [copiado, setCopiado] = useState(false)
  const { veredicto, achados, medidas, peca, perfil } = resultado
  const ordenados = [...achados].sort((a, b) => ORDEM[a.nivel] - ORDEM[b.nivel])

  const copiar = async () => {
    const texto = mensagemParaDesigner(resultado)
    try {
      await navigator.clipboard.writeText(texto)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2500)
    } catch {
      baixar('mensagem-para-o-designer.txt', texto, 'text/plain;charset=utf-8')
    }
  }

  return (
    <section className={`cartao resultado ${veredicto}`}>
      <LaudoCabecalho resultado={resultado} cadastro={cadastro} />

      <header className="veredicto">
        <div className="selo" aria-hidden>{veredicto === 'aprovado' ? '✓' : veredicto === 'ressalva' ? '!' : '×'}</div>
        <div>
          <h2>{ROTULO_VEREDICTO[veredicto]}</h2>
          <p>{RESUMO[veredicto]}</p>
        </div>
      </header>

      {medidas.miniaturaUrl && (
        <div className="previa">
          <img src={medidas.miniaturaUrl} alt="Pré-visualização da arte enviada" />
          <dl className="numeros">
            <div><dt>Arquivo</dt><dd>{medidas.arquivo?.nome}</dd></div>
            <div><dt>Formato</dt><dd>{medidas.formatoRotulo || medidas.formato}</dd></div>
            {medidas.larguraPx ? (
              <div><dt>Pixels</dt><dd>{fmt(medidas.larguraPx)} × {fmt(medidas.alturaPx)}</dd></div>
            ) : (
              <div><dt>Conteúdo</dt><dd>Vetorial</dd></div>
            )}
            {resultado.resolucao?.dpi > 0 && !medidas.puroVetor && (
              <div><dt>No tamanho impresso</dt><dd>{fmt(resultado.resolucao.dpi)} dpi</dd></div>
            )}
            <div><dt>Peça</dt><dd>{fmt(peca.larguraCm)} × {fmt(peca.alturaCm)} cm</dd></div>
            <div><dt>Tamanho</dt><dd>{medidas.arquivo?.tamanhoRotulo}</dd></div>
          </dl>
        </div>
      )}

      <ul className="achados">
        {ordenados.map((a) => (
          <li key={a.id} className={a.nivel}>
            <span className="marca" aria-hidden>{ICONE[a.nivel]}</span>
            <div>
              <strong>{a.titulo}</strong>
              {a.detalhe && <p>{a.detalhe}</p>}
              {a.acao && <p className="acao">→ {a.acao}</p>}
            </div>
          </li>
        ))}
      </ul>

      {veredicto === 'ressalva' && (
        <div className="risco">
          {riscoAceito ? (
            <p className="risco-ok">
              ✓ Risco aceito por <strong>{riscoAceito.nome || '—'}</strong>
              {riscoAceito.email && ` (${riscoAceito.email})`} em{' '}
              {new Date(riscoAceito.em).toLocaleString('pt-BR')}. A peça segue
              para produção como está.
            </p>
          ) : (
            <AceiteDeRisco onAceitar={onAceitarRisco} />
          )}
        </div>
      )}

      {/*
        A condição olhava `medidas.bitmap`, que só existia no caminho do JPG —
        então a caixa nunca aparecia em PDF, que é o formato normal em grande
        formato. Some sem erro nenhum na tela, que é o pior jeito de um recurso
        não funcionar. Agora as duas origens entregam uma `fonteVisual`.

        Arte puramente vetorial continua de fora, e isso é correto: ela não tem
        resolução: não há granulação para simular nem "mínimo exigido" com que
        comparar.
      */}
      {medidas.fonteVisual && !medidas.puroVetor && (
        <div className="bloco-simulador">
          <h3>Como esta arte vai ser vista</h3>
          <p className="ajuda">
            Arraste a distância e compare. É a pergunta que importa de verdade:
            não "quantos pixels tem", e sim se alguém enxerga a diferença de
            onde vai olhar.
          </p>
          <Simulador
            medidas={medidas}
            peca={peca}
            perfil={perfil}
            dpiMin={resultado.resolucao?.minimo?.dpi ?? perfil.dpiMin}
          />
        </div>
      )}

      {arquivo && cadastro && (
        <Envio
          resultado={resultado}
          arquivo={arquivo}
          cadastro={cadastro}
          riscoAceito={riscoAceito}
          projeto={projeto}
          onEnviado={onEnviado}
        />
      )}

      <div className="acoes">
        <button className="btn btn-ghost" onClick={copiar}>
          {copiado ? '✓ Copiado' : 'Copiar mensagem para o designer'}
        </button>
        <button
          className="btn btn-ghost"
          onClick={() => baixar(
            `laudo-${(medidas.arquivo?.nome || 'arte').replace(/\.[^.]+$/, '')}.json`,
            JSON.stringify(laudoJson(resultado), null, 2),
            'application/json',
          )}
        >
          Baixar laudo (JSON)
        </button>
        <button className="btn btn-ghost" onClick={() => window.print()}>Imprimir / PDF</button>
      </div>

      {modoTecnico && <PainelTecnico resultado={resultado} />}
    </section>
  )
}

/**
 * Aceite da ressalva, com identificação obrigatória.
 *
 * A data sozinha não resolve nada na hora da discussão: o link do stand circula
 * entre marketing, agência e diretoria, e "alguém com o link aceitou" não é
 * assinatura de ninguém. Nome e e-mail transformam o registro em prova de quem
 * autorizou imprimir daquele jeito — que é o motivo de a ressalva existir.
 */
function AceiteDeRisco({ onAceitar }) {
  const [nome, setNome] = useState('')
  const [email, setEmail] = useState('')
  const valido = nome.trim().length > 2 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())

  return (
    <>
      <p>
        Nada aqui impede a impressão. Se o resultado descrito acima é aceitável
        para você, identifique-se e a peça segue para produção.
      </p>
      <div className="linha">
        <label className="campo">
          <span>Seu nome</span>
          <input type="text" value={nome} onChange={(e) => setNome(e.target.value)} autoComplete="name" />
        </label>
        <label className="campo">
          <span>Seu e-mail</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        </label>
      </div>
      <button
        className="btn btn-risco"
        disabled={!valido}
        onClick={() => onAceitar({ nome: nome.trim(), email: email.trim().toLowerCase() })}
      >
        Aceito o risco e autorizo a impressão
      </button>
      <p className="nota">
        Fica registrado com data e hora. Como mais de uma pessoa pode ter este
        link, o registro precisa dizer quem autorizou.
      </p>
    </>
  )
}

/**
 * Cabeçalho que só aparece no papel.
 *
 * O laudo impresso circula por e-mail e chega longe da tela que o gerou —
 * então ele precisa dizer sozinho de quem é a arte, de que peça se trata e
 * quando foi analisada. Na tela isso seria repetição do que já está à vista.
 */
function LaudoCabecalho({ resultado, cadastro }) {
  const { peca, perfil, medidas, escalaFator } = resultado
  const spec = especificacao(peca, perfil, resultado.politica)
  const linha = (rotulo, valor) =>
    valor ? <div key={rotulo}><dt>{rotulo}</dt><dd>{valor}</dd></div> : null

  return (
    <header className="laudo-cabecalho so-impressao">
      <h1>Laudo de análise de arte</h1>
      <p className="sub">
        Gerado em {new Date(medidas.analisadoEm || Date.now()).toLocaleString('pt-BR')}
        {medidas.arquivo?.hash && ` · SHA-256 ${medidas.arquivo.hash.slice(0, 16)}…`}
      </p>
      <dl>
        {linha('Expositor', cadastro?.nome)}
        {linha('Stand', cadastro?.stand)}
        {linha('Feira', cadastro?.feira)}
        {linha('Localização', cadastro?.localizacao)}
        {linha('E-mail', cadastro?.email)}
        {linha('Peça', perfil?.nome)}
        {linha('Tamanho final', `${fmt(peca.larguraCm)} × ${fmt(peca.alturaCm)} cm`)}
        {linha('Com sangria', `${fmt(spec.comSangria.larguraCm)} × ${fmt(spec.comSangria.alturaCm)} cm (${spec.sangriaMm} mm por lado)`)}
        {escalaFator > 1 ? linha('Escala de trabalho', `1:${escalaFator}`) : null}
        {linha('Arquivo', medidas.arquivo?.nome)}
        {linha('Tamanho do arquivo', medidas.arquivo?.tamanhoRotulo)}
      </dl>
    </header>
  )
}

function PainelTecnico({ resultado }) {
  const { medidas, resolucao } = resultado
  const linha = (rotulo, valor) =>
    valor === null || valor === undefined || valor === '' ? null : (
      <div key={rotulo}><dt>{rotulo}</dt><dd>{valor}</dd></div>
    )

  return (
    <details className="tecnico" open>
      <summary>Detalhe técnico (time de comunicação visual)</summary>
      <dl>
        {linha('SHA-256', medidas.arquivo?.hash?.slice(0, 32) + '…')}
        {linha('Formato real (assinatura)', medidas.formato)}
        {linha('Piso da empresa', resolucao?.pisoEmpresa ? `${resolucao.pisoEmpresa} dpi` : null)}
        {linha('DPI na escala de trabalho', resolucao?.escala > 1 ? `${resolucao.dpiNaEscala.toFixed(1)} dpi (1:${resolucao.escala})` : null)}
        {linha('DPI horizontal / vertical', resolucao?.dpiH ? `${resolucao.dpiH.toFixed(1)} / ${resolucao.dpiV.toFixed(1)}` : null)}
        {linha('DPI declarado no arquivo', medidas.densidadeDeclarada)}
        {linha('Tamanho declarado', medidas.tamanhoDeclaradoCm
          ? `${medidas.tamanhoDeclaradoCm.largura.toFixed(1)} × ${medidas.tamanhoDeclaradoCm.altura.toFixed(1)} cm` : null)}
        {linha('Qualidade JPEG estimada', medidas.qualidadeJpeg)}
        {linha('Índice de blocagem', medidas.blocagem?.toFixed(3))}
        {linha('Queda espectral', medidas.inflacao?.quedaDb != null
          ? `${medidas.inflacao.quedaDb.toFixed(2)} dB — ${medidas.inflacao.confiavel ? 'não sustenta a resolução' : 'sem evidência de ampliação'}` : null)}
        {linha('Corte / ganho do ajuste', medidas.inflacao?.fCorte != null
          ? `f=${medidas.inflacao.fCorte.toFixed(3)} · ganho ${medidas.inflacao.ganho?.toFixed(2)} · α ${medidas.inflacao.alfa?.toFixed(2)}` : null)}
        {linha('Recortes analisados', medidas.inflacao?.amostras)}
        {linha('Área chapada', medidas.chapado != null ? `${(medidas.chapado * 100).toFixed(0)}%` : null)}
        {linha('Energia de borda na margem / miolo', medidas.margem
          ? `${medidas.margem.densidadeMargem.toFixed(4)} / ${medidas.margem.densidadeMiolo.toFixed(4)} (razão ${medidas.margem.razao.toFixed(2)})` : null)}
        {linha('Saturação média', medidas.cor ? medidas.cor.saturacaoMedia.toFixed(3) : null)}
        {linha('Perfil ICC', medidas.temICC === null ? null : medidas.temICC ? 'presente' : 'ausente')}
        {linha('Páginas (PDF)', medidas.paginas)}
        {linha('Fração raster (PDF)', medidas.fracaoRaster != null ? `${(medidas.fracaoRaster * 100).toFixed(0)}%` : null)}
        {medidas.dpiImagens?.length
          ? linha('Imagens embutidas', medidas.dpiImagens.map((i) => `${i.px}×${i.py} @ ${i.dpi.toFixed(0)} dpi`).join(' · '))
          : null}
      </dl>
    </details>
  )
}
