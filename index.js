const fs = require('fs');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const os = require('os');
const path = require('path');

// Конфігурація
const MATRIX_SIZES = [100, 1000, 5000];
const MAX_THREADS = 100;
const NUM_RUNS = 3; // Кількість прогонів для усереднення

// Системна інформація
const systemInfo = {
  processor: os.cpus()[0].model,
  cores: os.cpus().length,
  totalMemory: `${Math.round(os.totalmem() / (1024 * 1024 * 1024))} GB`,
  architecture: os.arch(),
  platform: os.platform(),
  release: os.release(),
};

console.log('Системна інформація:');
console.log(JSON.stringify(systemInfo, null, 2));

// Реалізація швидкого сортування (Quick Sort)
function quickSort(arr) {
  if (arr.length <= 1) {
    return arr;
  }
  
  const pivot = arr[Math.floor(arr.length / 2)];
  const left = arr.filter(x => x < pivot);
  const middle = arr.filter(x => x === pivot);
  const right = arr.filter(x => x > pivot);
  
  // Сортуємо за спаданням (по зменшенню)
  return [...quickSort(right), ...middle, ...quickSort(left)];
}

// Функція для генерації матриці з випадковими числами
function generateMatrix(size) {
  const matrix = [];
  for (let i = 0; i < size; i++) {
    const row = [];
    for (let j = 0; j < size; j++) {
      row.push(Math.floor(Math.random() * 10000));
    }
    matrix.push(row);
  }
  return matrix;
}

// Функція для сортування матриці в одному потоці
function sortMatrixSingleThread(matrix) {
  const sortedMatrix = [];
  for (let i = 0; i < matrix.length; i++) {
    sortedMatrix.push(quickSort([...matrix[i]]));
  }
  return sortedMatrix;
}

// Функція для сортування матриці в декількох потоках
async function sortMatrixMultiThreaded(matrix, numThreads) {
  // Якщо кількість потоків більша за кількість рядків, обмежуємо
  const actualThreads = Math.min(numThreads, matrix.length);
  
  // Створюємо чергу рядків для сортування
  const rowQueue = Array.from({ length: matrix.length }, (_, i) => i);
  let sortedMatrix = Array(matrix.length).fill(null);
  
  // Створюємо пул воркерів
  const workers = [];
  const workerPromises = [];
  
  for (let i = 0; i < actualThreads; i++) {
    workerPromises.push(new Promise((resolve) => {
      const worker = new Worker(__filename, {
        workerData: { isWorker: true }
      });
      
      workers.push(worker);
      
      worker.on('message', ({ rowIndex, sortedRow }) => {
        sortedMatrix[rowIndex] = sortedRow;
        
        // Якщо в черзі ще є рядки, відправляємо наступний
        if (rowQueue.length > 0) {
          const nextRowIndex = rowQueue.shift();
          worker.postMessage({ 
            command: 'sort', 
            row: matrix[nextRowIndex], 
            rowIndex: nextRowIndex 
          });
        } else {
          // Якщо черга порожня, завершуємо воркер
          worker.postMessage({ command: 'exit' });
        }
      });
      
      worker.on('exit', () => {
        resolve();
      });
      
      // Запускаємо початкове сортування, якщо є рядки в черзі
      if (rowQueue.length > 0) {
        const rowIndex = rowQueue.shift();
        worker.postMessage({ 
          command: 'sort', 
          row: matrix[rowIndex], 
          rowIndex: rowIndex 
        });
      } else {
        worker.postMessage({ command: 'exit' });
      }
    }));
  }
  
  // Чекаємо завершення всіх воркерів
  await Promise.all(workerPromises);
  
  return sortedMatrix;
}

// Функція для вимірювання часу виконання
async function measureSortingTime(matrixSize, numThreads) {
  console.log(`Матриця ${matrixSize}x${matrixSize}, потоків: ${numThreads}`);
  
  const results = [];
  
  for (let run = 0; run < NUM_RUNS; run++) {
    // Генеруємо матрицю
    const matrix = generateMatrix(matrixSize);
    
    // Створюємо копію для перевірки
    const originalMatrix = matrix.map(row => [...row]);
    
    // Замір часу
    const startTime = process.hrtime.bigint();
    
    if (numThreads === 1) {
      sortMatrixSingleThread(matrix);
    } else {
      await sortMatrixMultiThreaded(matrix, numThreads);
    }
    
    const endTime = process.hrtime.bigint();
    const elapsedTimeMs = Number(endTime - startTime) / 1_000_000;
    
    console.log(`Прогін ${run + 1}: ${elapsedTimeMs.toFixed(2)} мс`);
    results.push(elapsedTimeMs);
  }
  
  // Розрахунок середнього часу
  const averageTime = results.reduce((sum, time) => sum + time, 0) / results.length;
  console.log(`Середній час: ${averageTime.toFixed(2)} мс`);
  
  return averageTime;
}

// Функція для збереження результатів у файл
function saveResults(results) {
  // Створюємо папку для результатів, якщо вона не існує
  const resultsDir = path.join(__dirname, 'results');
  if (!fs.existsSync(resultsDir)) {
    fs.mkdirSync(resultsDir);
  }
  
  // Записуємо результати для кожного розміру матриці
  for (const size of MATRIX_SIZES) {
    const sizeResults = results.filter(r => r.matrixSize === size);
    const csvData = 'threads,time_ms\n' + 
      sizeResults.map(r => `${r.numThreads},${r.time.toFixed(2)}`).join('\n');
    
    fs.writeFileSync(
      path.join(resultsDir, `matrix_${size}x${size}_results.csv`), 
      csvData
    );
    
    console.log(`Результати для матриці ${size}x${size} збережено`);
  }
  
  // Записуємо системну інформацію
  fs.writeFileSync(
    path.join(resultsDir, 'system_info.json'), 
    JSON.stringify(systemInfo, null, 2)
  );
}

// Функція для генерації HTML-графіків
function generateCharts(results) {
  const resultsDir = path.join(__dirname, 'results');
  let htmlContent = `
  <!DOCTYPE html>
  <html>
  <head>
    <title>Результати тестування паралельного сортування матриць</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
      .chart-container {
        width: 800px;
        height: 500px;
        margin: 20px auto;
      }
      body {
        font-family: Arial, sans-serif;
        max-width: 1000px;
        margin: 0 auto;
        padding: 20px;
      }
      table {
        border-collapse: collapse;
        width: 100%;
        margin-bottom: 20px;
      }
      th, td {
        border: 1px solid #ddd;
        padding: 8px;
        text-align: right;
      }
      th {
        background-color: #f2f2f2;
      }
      tr:nth-child(even) {
        background-color: #f9f9f9;
      }
    </style>
  </head>
  <body>
    <h1>Результати тестування паралельного сортування матриць</h1>
    
    <h2>Системна інформація</h2>
    <ul>
      <li><strong>Процесор:</strong> ${systemInfo.processor}</li>
      <li><strong>Кількість ядер:</strong> ${systemInfo.cores}</li>
      <li><strong>Оперативна пам'ять:</strong> ${systemInfo.totalMemory}</li>
      <li><strong>Архітектура:</strong> ${systemInfo.architecture}</li>
      <li><strong>Платформа:</strong> ${systemInfo.platform} ${systemInfo.release}</li>
    </ul>
  `;
  
  // Додаємо графіки і таблиці для кожного розміру матриці
  for (const size of MATRIX_SIZES) {
    const sizeResults = results.filter(r => r.matrixSize === size);
    
    // Додаємо таблицю з результатами
    htmlContent += `
    <h2>Матриця ${size}x${size}</h2>
    <table>
      <tr>
        <th>Кількість потоків</th>
        <th>Час виконання (мс)</th>
      </tr>
    `;
    
    sizeResults.forEach(result => {
      htmlContent += `
      <tr>
        <td>${result.numThreads}</td>
        <td>${result.time.toFixed(2)}</td>
      </tr>
      `;
    });
    
    htmlContent += `</table>
    
    <div class="chart-container">
      <canvas id="chart${size}"></canvas>
    </div>
    `;
  }
  
  // Додаємо скрипт для побудови графіків
  htmlContent += `
    <script>
      // Функція для побудови графіків
      function createChart(canvasId, labels, data, title) {
        const ctx = document.getElementById(canvasId).getContext('2d');
        new Chart(ctx, {
          type: 'line',
          data: {
            labels: labels,
            datasets: [{
              label: 'Час виконання (мс)',
              data: data,
              borderColor: 'rgb(75, 192, 192)',
              tension: 0.1,
              pointRadius: 2
            }]
          },
          options: {
            scales: {
              y: {
                beginAtZero: true,
                title: {
                  display: true,
                  text: 'Час (мс)'
                }
              },
              x: {
                title: {
                  display: true,
                  text: 'Кількість потоків'
                }
              }
            },
            plugins: {
              title: {
                display: true,
                text: title,
                font: {
                  size: 16
                }
              }
            }
          }
        });
      }
  `;
  
  // Створюємо графіки для кожного розміру матриці
  for (const size of MATRIX_SIZES) {
    const sizeResults = results.filter(r => r.matrixSize === size);
    
    htmlContent += `
      // Дані для матриці ${size}x${size}
      const labels${size} = [${sizeResults.map(r => r.numThreads).join(', ')}];
      const data${size} = [${sizeResults.map(r => r.time.toFixed(2)).join(', ')}];
      createChart('chart${size}', labels${size}, data${size}, 'Час сортування матриці ${size}x${size}');
    `;
  }
  
  htmlContent += `
    </script>
  </body>
  </html>
  `;
  
  fs.writeFileSync(path.join(resultsDir, 'results.html'), htmlContent);
  console.log('HTML-звіт з графіками згенеровано');
}

// Головна функція для виконання тестування
async function runBenchmark() {
  if (!isMainThread) {
    // Код для воркера
    parentPort.on('message', async (message) => {
      if (message.command === 'sort') {
        const sortedRow = quickSort(message.row);
        parentPort.postMessage({ rowIndex: message.rowIndex, sortedRow });
      } else if (message.command === 'exit') {
        process.exit(0);
      }
    });
    return;
  }
  
  // Код для головного потоку
  console.log('Починаємо тестування сортування матриць...');
  
  const allResults = [];
  
  // Тестуємо для різних розмірів матриць
  for (const size of MATRIX_SIZES) {
    console.log(`\n=== Матриця ${size}x${size} ===`);
    
    // Тестуємо різну кількість потоків
    for (let threads = 1; threads <= MAX_THREADS; threads++) {
      const time = await measureSortingTime(size, threads);
      allResults.push({ matrixSize: size, numThreads: threads, time });
    }
  }
  
  // Зберігаємо результати і генеруємо графіки
  saveResults(allResults);
  generateCharts(allResults);
  
  console.log('\nТестування завершено. Результати збережено в папці "results".');
}

runBenchmark().catch(console.error);
