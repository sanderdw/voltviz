# GridAmp Visualizer

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Run the app:
   `npm run dev`

## Run With Nginx (Docker)

Build and run the production container:

`docker build -t gridamp . && docker run --rm -p 8080:80 gridamp`

Then open:

`http://localhost:8080`
