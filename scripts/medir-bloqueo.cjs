/*
 * Sube un libro y mide cuánto tarda el backend en contestar mientras lo procesa.
 * Si el hilo principal se traba (embeddings, extracción), las consultas pasan de ms a segundos.
 *
 * Uso, desde backend/ (en local o en la VM de Azure):
 *   node scripts/medir-bloqueo.cjs --archivo libro.pdf --usuario <id> --correo <correo> [--api URL] [--conservar]
 *   (o BOOKMIND_TOKEN=<jwt> en vez de --usuario/--correo)
 * Sin --conservar, el libro de prueba se borra al terminar.
 */
const fs = require('node:fs');
const path = require('node:path');

const argumentos = Object.fromEntries(
  process.argv.slice(2).reduce((pares, valor, i, todos) => {
    if (valor.startsWith('--')) pares.push([valor.slice(2), todos[i + 1]?.startsWith('--') ? true : (todos[i + 1] ?? true)]);
    return pares;
  }, []),
);

require('dotenv').config({ quiet: true, path: path.join(__dirname, '..', '.env') });

const API = (argumentos.api ?? `http://localhost:${process.env.PORT ?? 3000}/api`).replace(/\/$/, '');
const INTERVALO_MS = 500;
const LIMITE_MS = 30 * 60_000;

function token() {
  if (process.env.BOOKMIND_TOKEN) return process.env.BOOKMIND_TOKEN;
  if (!argumentos.usuario || !argumentos.correo || !process.env.JWT_SECRET) {
    throw new Error('Falta BOOKMIND_TOKEN, o --usuario y --correo con JWT_SECRET en el .env.');
  }
  const jwt = require('jsonwebtoken');
  return jwt.sign({ sub: argumentos.usuario, email: argumentos.correo }, process.env.JWT_SECRET, { expiresIn: '1h' });
}

const percentil = (ordenados, p) => ordenados[Math.min(ordenados.length - 1, Math.floor(ordenados.length * p))];

/** Hasta 2 min por consulta: si el servidor no contesta en ese tiempo, se anota como vencida y se sigue midiendo. */
async function cronometrar(url, cabeceras) {
  const inicio = performance.now();
  try {
    const respuesta = await fetch(url, { headers: cabeceras, signal: AbortSignal.timeout(120_000) });
    const cuerpo = await respuesta.json();
    return { ms: Math.round(performance.now() - inicio), cuerpo };
  } catch {
    return { ms: Math.round(performance.now() - inicio), cuerpo: {}, fallida: true };
  }
}

async function main() {
  if (!argumentos.archivo || !fs.existsSync(argumentos.archivo)) throw new Error('Indica un PDF o EPUB existente con --archivo.');
  const cabeceras = { Authorization: `Bearer ${token()}` };

  const salud = await cronometrar(`${API}/health`, {});
  console.log(`API ${API} · health en ${salud.ms} ms`);

  const cuerpo = new FormData();
  const nombre = path.basename(argumentos.archivo);
  cuerpo.append('file', new Blob([fs.readFileSync(argumentos.archivo)]), nombre);
  const inicioSubida = performance.now();
  const subida = await fetch(`${API}/documents`, { method: 'POST', headers: cabeceras, body: cuerpo });
  const documento = await subida.json();
  if (!subida.ok) throw new Error(`La subida falló (${subida.status}): ${documento.message}`);
  console.log(`subida de ${nombre} (${(fs.statSync(argumentos.archivo).size / 1e6).toFixed(1)} MB) en ${Math.round(performance.now() - inicioSubida)} ms`);

  const inicio = performance.now();
  const muestras = [];
  let estado = documento.processingStatus;

  while (performance.now() - inicio < LIMITE_MS) {
    // Las dos consultas que hace la app mientras tanto: el libro que se sigue y la biblioteca.
    const [libro, biblioteca] = await Promise.all([
      cronometrar(`${API}/documents/${documento.id}`, cabeceras),
      cronometrar(`${API}/documents`, cabeceras),
    ]);
    const segundo = Math.round((performance.now() - inicio) / 1000);
    const fallidas = [libro, biblioteca].filter((c) => c.fallida).length;
    const actual = libro.cuerpo.processingStatus ?? estado;
    muestras.push({ segundo, estado: actual, libro: libro.ms, biblioteca: biblioteca.ms, fallidas });

    if (actual !== estado || fallidas > 0 || Math.max(libro.ms, biblioteca.ms) > 1000) {
      const ocr = libro.cuerpo.progresoOcr ? ` ${libro.cuerpo.progresoOcr.procesadas}/${libro.cuerpo.progresoOcr.total}` : '';
      const aviso = fallidas > 0 ? `  (${fallidas} sin respuesta)` : '';
      console.log(`${String(segundo).padStart(4)} s  ${actual}${ocr}  libro ${libro.ms} ms · biblioteca ${biblioteca.ms} ms${aviso}`);
    }
    estado = actual;
    if (!['pending', 'processing', 'ocr'].includes(estado)) break;
    await new Promise((r) => setTimeout(r, INTERVALO_MS));
  }

  const tiempos = muestras.flatMap((m) => [m.libro, m.biblioteca]).sort((a, b) => a - b);
  const resumen = {
    archivo: nombre,
    api: API,
    estadoFinal: estado,
    segundos: Math.round((performance.now() - inicio) / 1000),
    consultas: tiempos.length,
    p50: percentil(tiempos, 0.5),
    p95: percentil(tiempos, 0.95),
    maximo: tiempos.at(-1),
    sobreUnSegundo: tiempos.filter((t) => t > 1000).length,
    sinRespuesta: muestras.reduce((suma, m) => suma + m.fallidas, 0),
  };
  console.log(
    `\n${resumen.estadoFinal} en ${resumen.segundos} s · ${resumen.consultas} consultas: ` +
      `p50 ${resumen.p50} ms, p95 ${resumen.p95} ms, máx ${resumen.maximo} ms, ` +
      `${resumen.sobreUnSegundo} sobre 1 s, ${resumen.sinRespuesta} sin respuesta`,
  );

  const destino = path.join(__dirname, `medir-bloqueo-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(destino, JSON.stringify({ resumen, muestras }, null, 2));
  console.log(`detalle en ${destino}`);

  if (!argumentos.conservar) {
    const borrado = await fetch(`${API}/documents/${documento.id}`, { method: 'DELETE', headers: cabeceras });
    console.log(borrado.ok ? 'libro de prueba borrado' : `no se pudo borrar el libro de prueba (${borrado.status})`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
