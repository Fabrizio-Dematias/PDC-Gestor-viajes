import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * Identificador de la request que se está atendiendo, disponible en
 * cualquier punto de su ejecución sin pasarlo de mano en mano
 * (`AsyncLocalStorage`: el valor viaja con la cadena de `await`s).
 *
 * Es el hilo que une los logs de servicios distintos: el agregador
 * recibe una búsqueda, le asigna (o hereda) un id, y `pedirJson` lo
 * manda en la cabecera `x-request-id` a cada servicio que llama; cada
 * uno lo imprime en su propia línea de log. Con eso, una búsqueda que
 * tocó el agregador, vuelos y usuarios se puede seguir de punta a punta
 * buscando una sola cadena de texto — sin librería de tracing, que para
 * este tamaño sería más complicada que lo que resuelve.
 *
 * Es middleware en el sentido del Módulo 4: una pieza genérica que se
 * intercala entre el código de negocio y la red, y que el código de
 * negocio no necesita conocer.
 */
const almacen = new AsyncLocalStorage()

export const conIdDePedido = (id, fn) => almacen.run({ id }, fn)
export const idDePedido = () => almacen.getStore()?.id
