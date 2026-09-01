import { useEffect, useState } from 'react'
import { ROTULO_VEREDICTO, especificacao } from '../core/regras.js'
import { agruparAchados, chamadaDoVeredicto, TENTAR_DE_NOVO_E_LIVRE } from '../core/laudo.js'
import { mensagemParaDesigner, laudoJson } from '../core/mensagem.js'
import Simulador from './Simulador.jsx'
import Envio from './Envio.jsx'

const ICONE = { ok: '✓', info: 'i', ressalva: '!', bloqueante: '×' }
const fmt = (n) => new Intl.NumberFormat('pt-BR').format(Math.round(n))

function baixar(nome, conteudo, tipo) {
  const blob = new Blob([conteudo], { type: tipo })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nome
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

/** Rola até a área de soltar o arquivo e pisca, em vez de descrevê-la em texto. */
function irParaOUpload() {
  const alvo = document.getElementById('area-de-envio')
  if (!alvo) return
  alvo.scrollIntoView({ behavior: 'smooth', block: 'center' })
  alvo.classList.add('piscando')
  setTimeout(() => alvo.classList.remove('piscando'), 2400)
}

export default function Resultado({
  resultado, modoTecnico, onAceitarRisco, riscoAceito, arquivo, cadastro, projeto,
  onEnviado, onFalarComTime,
}) {
  const [copiado, setCopiado] = useState(false)
  // O laudo em papel não pode depender de alguém ter clicado no triângulo.
  // Vale para o botão "Imprimir / PDF" e para o Ctrl+P do navegador — os dois
  // disparam `beforeprint`.
  const [abrirTudo, setAbrirTudo] = useState(false)
  useEffect(() => {
    const abrir = () => setAbrirTudo(true)
    window.addEventListener('beforeprint', abrir)
    return () => window.removeEventListener('beforeprint', abrir)
  }, [])

  const { veredicto, achados, medidas, peca, perfil } = resultado
  const grupos = agruparAchados(achados)
  const chamada = chamadaDoVeredicto(veredicto, grupos.impedem.length)

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

      {/*
        A primeira frase diz o que fazer, não que nota a arte tirou. O rótulo
        formal continua na tela, como etiqueta: ele é a palavra que o time usa
        e a que aparece no laudo impresso, mas não é com ela que o cliente age.
      */}
      <header className="veredicto">
        <div className="selo" aria-hidden>{veredicto === 'aprovado' ? '✓' : veredicto === 'ressalva' ? '!' : '×'}</div>
        <div>
          <h2>{chamada.titulo}</h2>
          <p>{chamada.texto}</p>
          <span className={`etiqueta-veredicto ${veredicto}`}>{ROTULO_VEREDICTO[veredicto]}</span>
        </div>
      </header>

      {/*
        O que impede vem primeiro, numerado e sozinho. Na lista única — tudo
        junto, ordenado por gravidade — o item que barra a impressão aparecia
        no topo de outros sete, do mesmo tamanho: quem lia contava oito
        problemas onde havia um, e não sabia por qual começar.
      */}
      {grupos.impedem.length > 0 && (
        <section className="bloco-achados impede">
          <h3>
            {grupos.impedem.length === 1
              ? 'O que precisa mudar antes de enviar'
              : `As ${grupos.impedem.length} coisas que precisam mudar antes de enviar`}
          </h3>
          <ol className="achados numerado">
            {grupos.impedem.map((a) => <ItemAchado key={a.id} achado={a} />)}
          </ol>
        </section>
      )}

      {veredicto === 'reprovado' && (
        <ProximoPasso
          onCopiar={copiar}
          copiado={copiado}
          onFalarComTime={onFalarComTime}
          temEnvio={Boolean(arquivo && cadastro)}
        />
      )}

      {medidas.miniaturaUrl && (
        <div className="previa">
          <img src={medidas.miniaturaUrl} alt="Pré-visualização da arte enviada" />
          <dl className="numeros">
            <div><dt>Arquivo</dt><dd>{medidas.arquivo?.nome}</dd></div>
            <div><dt>Formato</dt><dd>{medidas.formatoRotulo || medidas.formato}</dd></div>
            {/*
              Num PDF, `larguraPx` não é o arquivo: é quantos pixels ele teria
              se tivesse o tamanho da peça. Mostrar isso como "Pixels" entrega
              ao cliente um número que ele não encontra em lugar nenhum se for
              conferir no editor — e este quadro existe justamente para ele
              confirmar que mandou o arquivo certo.
            */}
            {medidas.pixelsDaImagem ? (
              <div>
                <dt>Maior imagem no PDF</dt>
                <dd>{fmt(medidas.pixelsDaImagem.largura)} × {fmt(medidas.pixelsDaImagem.altura)} px</dd>
              </div>
            ) : medidas.larguraPx ? (
              <div><dt>Pixels</dt><dd>{fmt(medidas.larguraPx)} × {fmt(medidas.alturaPx)}</dd></div>
            ) : (
              <div><dt>Conteúdo</dt><dd>Vetorial</dd></div>
            )}
            {medidas.tamanhoDeclaradoCm && (
              <div>
                <dt>Arquivo montado em</dt>
                <dd>
                  {fmt(medidas.tamanhoDeclaradoCm.largura)} × {fmt(medidas.tamanhoDeclaradoCm.altura)} cm
                </dd>
              </div>
            )}
            {resultado.resolucao?.dpi > 0 && !medidas.puroVetor && (
              <div>
                <dt>Pontos por polegada<br /><em className="dica-campo">no tamanho impresso</em></dt>
                <dd>{fmt(resultado.resolucao.dpi)} dpi</dd>
              </div>
            )}
            <div><dt>Peça</dt><dd>{fmt(peca.larguraCm)} × {fmt(peca.alturaCm)} cm</dd></div>
            <div><dt>Tamanho</dt><dd>{medidas.arquivo?.tamanhoRotulo}</dd></div>
          </dl>
        </div>
      )}

      {grupos.conferir.length > 0 && (
        <section className="bloco-achados">
          <h3>
            {veredicto === 'reprovado'
              ? 'Outros pontos — estes não impedem a impressão'
              : 'O que vale conferir antes de seguir'}
          </h3>
          <ul className="achados">
            {grupos.conferir.map((a) => <ItemAchado key={a.id} achado={a} />)}
          </ul>
        </section>
      )}

      {/*
        O que está certo sai da frente, mas não some: é ele que mostra que a
        conferência olhou a arte inteira, e não só achou defeito.
      */}
      {grupos.certos.length > 0 && (
        <details className="bloco-certos" open={abrirTudo || undefined}>
          <summary>Já está certo nesta arte ({grupos.certos.length})</summary>
          <ul className="achados">
            {grupos.certos.map((a) => <ItemAchado key={a.id} achado={a} />)}
          </ul>
        </details>
      )}

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
            <AceiteDeRisco onAceitar={onAceitarRisco} onCopiar={copiar} copiado={copiado} />
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

function ItemAchado({ achado }) {
  return (
    <li className={achado.nivel}>
      <span className="marca" aria-hidden>{ICONE[achado.nivel]}</span>
      <div>
        <strong>{achado.titulo}</strong>
        {achado.detalhe && <p>{achado.detalhe}</p>}
        {achado.acao && <p className="acao">→ {achado.acao}</p>}
      </div>
    </li>
  )
}

/**
 * "E agora?" — a parte que faltava.
 *
 * O diagnóstico que produziu esta caixa foi literal: o cliente "não entendeu o
 * resultado, não soube o que fazer depois da recusa". E não é falta de atenção
 * dele. A tela terminava numa lista de defeitos, num botão de enviar desligado
 * e em três botões cinza do mesmo tamanho, um deles escrito "Copiar mensagem
 * para o designer" — que era o caminho certo, no rodapé, com a mesma aparência
 * de "Baixar laudo (JSON)".
 *
 * Os três caminhos aqui não são uma lista de opções: são as três situações
 * reais de quem está parado nesta tela. Ele é o cliente e tem agência; ele é o
 * cliente e vai mexer no arquivo; ele não sabe o que nada disso quer dizer. O
 * terceiro é o caso que virava telefonema, e por isso tem botão também.
 */
function ProximoPasso({ onCopiar, copiado, onFalarComTime, temEnvio }) {
  return (
    <section className="proximo-passo">
      <h3>E agora, o que eu faço?</h3>
      <ol>
        <li>
          <strong>Quem montou a arte foi outra pessoa</strong>
          <p>
            Copie o texto pronto e mande para ela. Vai com as medidas exatas, o
            que está errado e o que precisa ter no lugar — é o suficiente para
            corrigir sem ninguém precisar perguntar nada.
          </p>
          <button className="btn" onClick={onCopiar}>
            {copiado ? '✓ Copiado — agora é só colar e mandar' : 'Copiar o que precisa mudar'}
          </button>
        </li>
        <li>
          <strong>Você mesmo vai corrigir o arquivo</strong>
          <p>
            Ajuste e traga o arquivo novo aqui na mesma página — a conferência é
            na hora. {TENTAR_DE_NOVO_E_LIVRE}
          </p>
          <button className="btn btn-ghost" onClick={irParaOUpload}>
            Escolher outro arquivo
          </button>
        </li>
        {temEnvio && onFalarComTime && (
          <li>
            <strong>Não ficou claro o que fazer</strong>
            <p>
              Fale com a nossa equipe pela conversa desta página. Ela já sabe de
              que stand e de que peça você está falando, e o que a análise
              apontou — você não precisa explicar nada disso de novo.
            </p>
            <button className="btn btn-ghost" onClick={onFalarComTime}>
              Falar com a equipe
            </button>
          </li>
        )}
      </ol>
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
function AceiteDeRisco({ onAceitar, onCopiar, copiado }) {
  const [nome, setNome] = useState('')
  const [email, setEmail] = useState('')
  const valido = nome.trim().length > 2 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())

  return (
    <>
      {/*
        Duas saídas, e a segunda existe porque a ressalva é uma pergunta de
        verdade: "aceito assim" e "prefiro corrigir" são as duas respostas. Sem
        a segunda visível, quem não queria aceitar ficava sem nada para clicar.
      */}
      <p>
        Nada aqui impede a impressão. Se o resultado descrito acima é aceitável
        para você, identifique-se e a peça segue para produção. Se preferir
        corrigir antes, o caminho é o mesmo de sempre — trocar o arquivo aqui em
        cima, sem custo e sem limite de tentativas.
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
      <div className="acoes">
        <button
          className="btn btn-risco"
          disabled={!valido}
          onClick={() => onAceitar({ nome: nome.trim(), email: email.trim().toLowerCase() })}
        >
          Aceito o risco e autorizo a impressão
        </button>
        <button className="btn btn-ghost" onClick={onCopiar}>
          {copiado ? '✓ Copiado' : 'Prefiro corrigir — copiar o que mudar'}
        </button>
      </div>
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
