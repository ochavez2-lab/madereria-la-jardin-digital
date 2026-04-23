# POS Maderería La Jardín — Instrucciones

## Requisitos
- Node.js instalado (descargar en nodejs.org)

## Instalar y correr

1. Abre la carpeta `pos` en la terminal
2. Instala dependencias (solo la primera vez):
   ```
   npm install
   ```
3. Corre el servidor:
   ```
   node server.js
   ```

## URLs

- **Cajero (tu laptop/tablet del negocio):**
  http://localhost:3000/cajero.html

- **Cliente (tablet que ve el cliente):**
  http://TU_IP_LOCAL:3000/cliente.html

  La IP local la muestra la terminal al arrancar el servidor.
  Ejemplo: http://192.168.1.5:3000/cliente.html

## Cómo funciona

1. Abre `cajero.html` en la laptop del negocio
2. Abre `cliente.html` en la tablet del cliente (misma red WiFi)
3. Al seleccionar productos en el cajero, el cliente los ve en tiempo real
4. Al cobrar, se genera la nota de remisión para imprimir
5. Desde "Ver remisiones del día" puedes anular cualquier nota

## Datos
- Se guardan en `datos.json` automáticamente
- Nunca se pierden aunque apagues el servidor
