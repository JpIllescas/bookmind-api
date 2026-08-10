import { PaginaExtraida } from '../../documents/services/extraccion.service';
import { FragmentacionService } from './fragmentacion.service';

const palabras = (n: number, prefijo = 'palabra') =>
  Array.from({ length: n }, (_, i) => `${prefijo}${i}`).join(' ');

describe('FragmentacionService', () => {
  const servicio = new FragmentacionService();

  const paginas = (contenidos: string[]): PaginaExtraida[] =>
    contenidos.map((texto, i) => ({ pagina: i + 1, texto }));

  it('conserva la página de origen de cada fragmento', () => {
    const fragmentos = servicio.fragmentar(
      paginas([palabras(200, 'a'), palabras(200, 'b')]),
    );

    // Es la garantía que sostiene las citas: si un fragmento apunta a la
    // página equivocada, el estudiante abre la página y no encuentra nada.
    for (const fragmento of fragmentos) {
      const prefijo = fragmento.texto.startsWith('a') ? 1 : 2;
      expect(fragmento.pagina).toBe(prefijo);
    }
  });

  it('nunca mezcla dos páginas en un mismo fragmento', () => {
    const fragmentos = servicio.fragmentar(
      paginas([palabras(150, 'a'), palabras(150, 'b')]),
    );

    for (const fragmento of fragmentos) {
      const tieneA = fragmento.texto.includes('a0') || fragmento.texto.includes('a1');
      const tieneB = fragmento.texto.includes('b0') || fragmento.texto.includes('b1');
      expect(tieneA && tieneB).toBe(false);
    }
  });

  it('numera los fragmentos de forma correlativa', () => {
    const fragmentos = servicio.fragmentar(
      paginas([palabras(300, 'a'), palabras(300, 'b')]),
    );

    expect(fragmentos.map((f) => f.indice)).toEqual(
      fragmentos.map((_, i) => i),
    );
  });

  it('solapa los fragmentos vecinos', () => {
    const fragmentos = servicio.fragmentar(paginas([palabras(300)]));
    expect(fragmentos.length).toBeGreaterThan(1);

    // Sin solape, una frase partida en el corte pierde contexto a ambos lados.
    const primeras = new Set(fragmentos[0].texto.split(' '));
    const segundas = fragmentos[1].texto.split(' ');
    const compartidas = segundas.filter((p) => primeras.has(p));

    expect(compartidas.length).toBeGreaterThan(0);
  });

  it('descarta páginas casi vacías', () => {
    const fragmentos = servicio.fragmentar(
      paginas(['', '   ', 'tres palabras sueltas', palabras(200)]),
    );

    expect(fragmentos.every((f) => f.pagina === 4)).toBe(true);
  });

  it('devuelve vacío si el libro no tiene texto', () => {
    expect(servicio.fragmentar(paginas(['', '  ']))).toEqual([]);
  });

  it('no pierde el final de una página larga', () => {
    const fragmentos = servicio.fragmentar(paginas([palabras(250)]));
    const ultimo = fragmentos.at(-1);

    expect(ultimo?.texto).toContain('palabra249');
  });
});
