# TLC Panel Control - Lista de Precios ONLINE Railway

Esta version deja el modulo Lista de Precios listo para subir al servidor.

## Cambios importantes

- El servidor usa `process.env.PORT || 8080`, necesario para Railway.
- La base de precios ya no usa Drive, Sheets ni Apps Script.
- La base inicial esta en `data/precios.json`.
- Para produccion online se recomienda montar un Railway Volume y setear `DATA_DIR=/data`.
- Si el Volume esta vacio, la app copia automaticamente la base inicial incluida en el repo a `/data/precios.json`.
- Si `/data/precios.json` ya existe, NO se pisa al hacer deploy.

## Archivos a subir a GitHub

Subir/reemplazar:

- `start.js`
- `precios.html`
- `index.html`
- `package.json`
- `data/precios.json`

## Railway recomendado

1. En Railway, crear/montar un Volume en el servicio.
2. Mount path recomendado: `/data`
3. En Variables agregar:

```txt
DATA_DIR=/data
```

4. Hacer commit en GitHub. Railway deploya solo.

## Importante

No subir el archivo `data/precios.json` vacio. Este ZIP ya trae la base migrada.

Primero probar online con un producto de prueba:

1. Editar un producto.
2. Guardar.
3. Salir y volver a entrar.
4. Redeployar desde Railway o hacer un commit menor.
5. Confirmar que el cambio sigue estando.

Si sigue estando despues del redeploy, el Volume quedo bien configurado.
