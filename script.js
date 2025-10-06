class RadioPlayer {
    constructor() {
        this.audio = document.getElementById('audioPlayer');
        this.isPlaying = false;
        this.isConnected = false;
        this.currentSection = 'home';
        this.equalizerBars = []; // Array para barras del ecualizador principal
        this.fullscreenEqualizerBars = []; // Array para barras del visualizador de fondo
        this.metadataInterval = null;
        this.currentMetadata = {
            title: 'Conectando...',
            artist: 'RADIO STREAM',
            album: '',
            artwork: ''
        };
        this.songHistory = [];
        this.lastMetadataUpdate = null;
        
        // Sistema de reconexión automática
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        this.reconnectDelay = 1000; // Inicio con 1 segundo
        this.maxReconnectDelay = 30000; // Máximo 30 segundos
        this.reconnectTimeout = null;
        this.isReconnecting = false;
        this.lastStreamUrl = '';
        this.reconnectBackoff = 1.5; // Factor de incremento del delay
        
        // Detección de rendimiento para optimización automática
        this.performanceSettings = this.detectPerformance();
        
        this.initializeElements();
        this.setupEventListeners();
        this.createEqualizer();
        this.createFullscreenEqualizer(); // Crear visualizador de fondo
        this.startEqualizerAnimation();
        this.setupMediaSession();
        this.loadHistoryFromLocalStorage();
        this.loadDarkModePreference(); // Cargar preferencia de modo oscuro
    }

    // Detectar capacidad de rendimiento del dispositivo
    detectPerformance() {
        const isMobile = /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        const lowEndDevice = isMobile || window.innerWidth < 768 || navigator.hardwareConcurrency < 4;
        
        return {
            isMobile,
            lowEndDevice,
            maxMainBars: lowEndDevice ? 12 : 16,
            maxMainSegments: lowEndDevice ? 8 : 12,
            maxBackgroundBars: lowEndDevice ? 40 : 50, // Más barras para llenar completamente
            maxBackgroundSegments: lowEndDevice ? 15 : 30, // Más segmentos para mayor altura
            frameRate: lowEndDevice ? 1000 / 20 : 1000 / 30 // 20 FPS para dispositivos lentos
        };
    }

    initializeElements() {
        this.playPauseBtn = document.getElementById('playPauseBtn');
        this.currentTimeEl = document.getElementById('currentTime');
        this.albumArt = document.querySelector('.album-art');
        this.streamUrlInput = document.getElementById('streamUrl');
        this.connectBtn = document.getElementById('connectBtn');
        this.artistNameEl = document.getElementById('artistName');
        this.songTitleEl = document.getElementById('songTitle');
        this.miniTitleEl = document.getElementById('miniTitle');
        this.contentSections = document.querySelector('.content-sections');
        this.metadataIndicator = document.getElementById('metadataIndicator');
        this.miniPlayer = document.querySelector('.mini-player');
        this.closeMiniPlayerBtn = document.getElementById('closeMiniPlayer');
        this.showMiniPlayerBtn = document.getElementById('showMiniPlayerBtn');
        this.forceReconnectBtn = document.getElementById('forceReconnectBtn');
        
        // Elementos del control de volumen
        this.volumeSlider = document.getElementById('volumeSlider');
        this.volumeIcon = document.getElementById('volumeIcon');
        this.volumePercentage = document.getElementById('volumePercentage');
        
        // Inicializar volumen
        this.currentVolume = 0.8; // 80% por defecto
        this.audio.volume = this.currentVolume;
        this.previousVolume = this.currentVolume; // Para la función mute
        
        // Actualizar display inicial del volumen
        if (this.volumePercentage && this.volumeSlider) {
            this.volumeSlider.value = this.currentVolume * 100;
            this.updateVolumeDisplay();
            this.updateVolumeIcon();
        }
        
        // Inicialmente ocultar el mini player
        this.hideMiniPlayer();
    }

    setupEventListeners() {
        // Controles de reproducción
        this.playPauseBtn.addEventListener('click', () => this.togglePlayPause());
        
        // Conexión de stream
        this.connectBtn.addEventListener('click', () => this.connectStream());
        this.forceReconnectBtn.addEventListener('click', () => this.forceReconnect());

        // Eventos del audio
        this.audio.addEventListener('loadstart', () => this.onLoadStart());
        this.audio.addEventListener('canplay', () => this.onCanPlay());
        this.audio.addEventListener('error', () => this.onError());
        this.audio.addEventListener('timeupdate', () => this.updateTime());
        this.audio.addEventListener('play', () => this.onPlay());
        this.audio.addEventListener('pause', () => this.onPause());
        
        // Eventos para reconexión automática
        this.audio.addEventListener('abort', () => this.onStreamInterrupted('abort'));
        this.audio.addEventListener('emptied', () => this.onStreamInterrupted('emptied'));
        this.audio.addEventListener('stalled', () => this.onStreamInterrupted('stalled'));
        this.audio.addEventListener('suspend', () => this.onStreamInterrupted('suspend'));
        this.audio.addEventListener('waiting', () => this.onStreamWaiting());
        
        // Control por overlay del álbum
        document.querySelector('.play-overlay').addEventListener('click', () => {
            this.togglePlayPause();
        });

        // Input de Enter para conectar
        this.streamUrlInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.connectStream();
            }
        });
        
        // Controles del mini player
        this.closeMiniPlayerBtn.addEventListener('click', () => {
            this.hideMiniPlayer();
        });
        
        // Botón flotante para mostrar mini player
        this.showMiniPlayerBtn.addEventListener('click', () => {
            this.showMiniPlayer();
        });
        
        // Sleep Mode Toggle
        const sleepModeToggle = document.getElementById('sleepModeToggle');
        sleepModeToggle.addEventListener('click', () => this.toggleDarkMode());
        
        // Controles de volumen
        this.volumeSlider.addEventListener('input', (e) => this.changeVolume(e.target.value));
        this.volumeIcon.addEventListener('click', () => this.toggleMute());
        
        // Mejorar interacción del dropdown flotante
        const volumeDropdown = document.querySelector('.volume-floating-dropdown');
        const volumeContainer = document.querySelector('.volume-floating-container');
        
        if (volumeDropdown && volumeContainer) {
            // Mantener dropdown abierto mientras se usa el slider
            this.volumeSlider.addEventListener('mousedown', () => {
                volumeDropdown.classList.add('active');
            });
            
            this.volumeSlider.addEventListener('mouseup', () => {
                setTimeout(() => {
                    volumeDropdown.classList.remove('active');
                }, 1000); // Mantener abierto 1 segundo después de soltar
            });
            
            // Evitar que se cierre al hacer clic en el dropdown
            volumeDropdown.addEventListener('mousedown', (e) => {
                e.stopPropagation();
            });
        }
        
        // Redimensionar visualizadores cuando cambie el tamaño de ventana
        let resizeTimeout;
        window.addEventListener('resize', () => {
            // Debounce para evitar múltiples recreaciones
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
                // Solo recrear el visualizador de fondo si el cambio es significativo
                const newWidth = window.innerWidth;
                if (Math.abs(newWidth - this.lastWidth) > 100) {
                    this.createFullscreenEqualizer();
                    this.lastWidth = newWidth;
                }
            }, 250); // Esperar 250ms antes de recrear
        });
        
        // Guardar el ancho inicial
        this.lastWidth = window.innerWidth;
    }

    // Método para limpiar animaciones si es necesario (optimización)
    cleanup() {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
    }

    createEqualizer() {
        const container = document.getElementById('equalizerContainer');
        if (!container) return;
        
        container.innerHTML = '';
        this.equalizerBars = [];
        
        // Usar configuración optimizada según el dispositivo
        const numBars = this.performanceSettings.maxMainBars;
        const numSegments = this.performanceSettings.maxMainSegments;
        
        for (let i = 0; i < numBars; i++) {
            const bar = document.createElement('div');
            bar.className = 'eq-bar';
            
            // Crear segmentos optimizados según el dispositivo
            const segments = [];
            for (let j = 0; j < numSegments; j++) {
                const segment = document.createElement('div');
                segment.className = 'eq-segment';
                bar.appendChild(segment);
                segments.push(segment);
            }
            
            container.appendChild(bar);
            this.equalizerBars.push({
                element: bar,
                segments: segments,
                activeSegments: Math.floor(Math.random() * 3) + 1,
                targetHeight: Math.floor(Math.random() * 3) + 1,
                currentHeight: Math.floor(Math.random() * 3) + 1
            });
        }
    }

    createFullscreenEqualizer() {
        const container = document.getElementById('fullscreenEqualizerContainer');
        if (!container) return;
        
        container.innerHTML = '';
        this.fullscreenEqualizerBars = [];
        
        // Usar configuración optimizada según el dispositivo
        const numBars = this.performanceSettings.maxBackgroundBars;
        const maxSegments = this.performanceSettings.maxBackgroundSegments;
        
        for (let i = 0; i < numBars; i++) {
            const bar = document.createElement('div');
            bar.className = 'fullscreen-eq-bar';
            
            // Crear segmentos optimizados según el dispositivo
            const segments = [];
            
            for (let j = 0; j < maxSegments; j++) {
                const segment = document.createElement('div');
                segment.className = 'fullscreen-eq-segment';
                bar.appendChild(segment);
                segments.push(segment);
            }
            
            container.appendChild(bar);
            this.fullscreenEqualizerBars.push({
                element: bar,
                segments: segments,
                activeSegments: Math.floor(Math.random() * 5) + 1,
                targetHeight: Math.floor(Math.random() * 5) + 1,
                currentHeight: Math.floor(Math.random() * 5) + 1
            });
        }
    }

    startEqualizerAnimation() {
        // Variables para optimización de rendimiento
        let lastFrameTime = 0;
        const frameRate = this.performanceSettings.frameRate; // Usar frameRate optimizado
        let animationId;
        
        // Pre-calcular valores aleatorios para evitar cálculos en tiempo real
        const preCalculatedHeights = [];
        for (let i = 0; i < 100; i++) {
            preCalculatedHeights.push({
                main: Math.floor(Math.random() * (this.performanceSettings.maxMainSegments * 0.7)) + 1,
                background: Math.floor(Math.random() * (this.performanceSettings.maxBackgroundSegments * 0.6)) + 1,
                high: Math.floor(Math.random() * 5) + Math.max(8, this.performanceSettings.maxMainSegments * 0.8),
                calm: Math.floor(Math.random() * 3) + 1
            });
        }
        let heightIndex = 0;
        
        const animate = (currentTime) => {
            // Throttling: usar frameRate optimizado según el dispositivo
            if (currentTime - lastFrameTime >= frameRate) {
                
                if (this.isPlaying) {
                    // Animación optimizada del ecualizador principal
                    this.equalizerBars.forEach((bar, index) => {
                        const heights = preCalculatedHeights[heightIndex % preCalculatedHeights.length];
                        let targetHeight = heights.main;
                        
                        // Picos ocasionales pero más controlados
                        if (Math.random() > 0.90) {
                            targetHeight = Math.min(heights.high, bar.segments.length);
                        }
                        
                        // Suavizar transiciones en lugar de cambios abruptos
                        bar.targetHeight = targetHeight;
                        const diff = bar.targetHeight - bar.currentHeight;
                        bar.currentHeight += diff * 0.3; // Interpolación suave
                        
                        const finalHeight = Math.round(bar.currentHeight);
                        
                        // Actualizar solo segmentos que han cambiado
                        if (bar.activeSegments !== finalHeight) {
                            const startIdx = Math.min(bar.activeSegments, finalHeight);
                            const endIdx = Math.max(bar.activeSegments, finalHeight);
                            
                            for (let i = startIdx; i < endIdx; i++) {
                                if (i < bar.segments.length) {
                                    if (i < finalHeight) {
                                        bar.segments[i].classList.add('active');
                                    } else {
                                        bar.segments[i].classList.remove('active');
                                    }
                                }
                            }
                            bar.activeSegments = finalHeight;
                        }
                        
                        heightIndex++;
                    });

                    // Animación optimizada del visualizador de fondo
                    this.fullscreenEqualizerBars.forEach((bar, index) => {
                        const heights = preCalculatedHeights[(heightIndex + index) % preCalculatedHeights.length];
                        let targetHeight = heights.background;
                        
                        // Picos ocasionales más altos pero controlados
                        if (Math.random() > 0.85) {
                            targetHeight = Math.min(heights.high, bar.segments.length);
                        }
                        
                        // Suavizar transiciones
                        bar.targetHeight = targetHeight;
                        const diff = bar.targetHeight - bar.currentHeight;
                        bar.currentHeight += diff * 0.2; // Más suave para el fondo
                        
                        const finalHeight = Math.round(bar.currentHeight);
                        
                        // Actualizar solo segmentos que han cambiado
                        if (bar.activeSegments !== finalHeight) {
                            const startIdx = Math.min(bar.activeSegments, finalHeight);
                            const endIdx = Math.max(bar.activeSegments, finalHeight);
                            
                            for (let i = startIdx; i < endIdx; i++) {
                                if (i < bar.segments.length) {
                                    if (i < finalHeight) {
                                        bar.segments[i].classList.add('active');
                                    } else {
                                        bar.segments[i].classList.remove('active');
                                    }
                                }
                            }
                            bar.activeSegments = finalHeight;
                        }
                    });
                } else {
                    // Estado pausado - transición suave a altura mínima
                    [...this.equalizerBars, ...this.fullscreenEqualizerBars].forEach(bar => {
                        const calmHeight = preCalculatedHeights[heightIndex % preCalculatedHeights.length].calm;
                        
                        bar.targetHeight = calmHeight;
                        const diff = bar.targetHeight - bar.currentHeight;
                        bar.currentHeight += diff * 0.1; // Transición muy suave al pausar
                        
                        const finalHeight = Math.round(bar.currentHeight);
                        
                        if (bar.activeSegments !== finalHeight) {
                            const startIdx = Math.min(bar.activeSegments, finalHeight);
                            const endIdx = Math.max(bar.activeSegments, finalHeight);
                            
                            for (let i = startIdx; i < endIdx; i++) {
                                if (i < bar.segments.length) {
                                    if (i < finalHeight) {
                                        bar.segments[i].classList.add('active');
                                    } else {
                                        bar.segments[i].classList.remove('active');
                                    }
                                }
                            }
                            bar.activeSegments = finalHeight;
                        }
                        
                        heightIndex++;
                    });
                }
                
                lastFrameTime = currentTime;
            }
            
            // Continuar la animación
            animationId = requestAnimationFrame(animate);
        };
        
        // Iniciar la animación
        animationId = requestAnimationFrame(animate);
        
        // Guardar la referencia para poder cancelarla si es necesario
        this.animationId = animationId;
    }

    connectStream() {
        const url = this.streamUrlInput.value.trim();
        if (!url) {
            alert('Por favor ingresa una URL válida');
            return;
        }

        // Guardar URL para reconexión automática
        this.lastStreamUrl = url;
        
        // Cancelar cualquier reconexión en curso
        this.cancelReconnect();
        
        this.songTitleEl.textContent = 'Conectando...';
        this.connectBtn.textContent = 'Conectando...';
        this.connectBtn.disabled = true;

        this.audio.src = url;
        this.audio.load();
    }

    togglePlayPause() {
        if (!this.audio.src) {
            alert('Primero conecta un stream de radio');
            return;
        }

        if (this.isPlaying) {
            this.pause();
        } else {
            this.play();
        }
    }

    play() {
        this.audio.play()
            .then(() => {
                this.isPlaying = true;
                this.updatePlayButtons();
                this.albumArt.classList.add('playing');
            })
            .catch(error => {
                console.error('Error al reproducir:', error);
                alert('Error al reproducir el stream');
            });
    }

    pause() {
        this.audio.pause();
        this.isPlaying = false;
        this.updatePlayButtons();
        this.albumArt.classList.remove('playing');
    }

    updatePlayButtons() {
        const playIcon = this.isPlaying ? 'fa-pause' : 'fa-play';
        
        this.playPauseBtn.innerHTML = `<i class="fas ${playIcon}"></i>`;
    }

    onLoadStart() {
        this.songTitleEl.textContent = 'Cargando...';
        this.addStatusIndicator('loading');
    }

    onCanPlay() {
        this.isConnected = true;
        this.isReconnecting = false;
        
        // Resetear sistema de reconexión
        this.resetReconnectState();
        
        this.songTitleEl.textContent = 'Stream Conectado - Reproduciendo...';
        this.artistNameEl.textContent = 'RADIO ZENO FM';
        this.miniTitleEl.textContent = 'RADIO ZENO FM';
        this.connectBtn.textContent = 'Conectar Stream';
        this.connectBtn.disabled = false;
        this.addStatusIndicator('connected');
        this.showMiniPlayer(); // Mostrar mini player cuando se conecta
        
        // AutoPlay: Iniciar reproducción automáticamente
        this.startAutoPlay();
    }

    onError() {
        this.isConnected = false;
        console.log('Error de conexión detectado');
        
        // No ocultar mini player inmediatamente, intentar reconexión
        if (this.lastStreamUrl && !this.isReconnecting) {
            this.startReconnection('error');
        } else {
            // Solo mostrar error si no hay URL guardada o se agotaron los intentos
            this.songTitleEl.textContent = 'Error de conexión';
            this.connectBtn.textContent = 'Reconectar';
            this.connectBtn.disabled = false;
            this.addStatusIndicator('error');
            this.hideMiniPlayer(); // Ocultar mini player cuando hay error
        }
    }

    updateTime() {
        if (this.audio.currentTime) {
            const minutes = Math.floor(this.audio.currentTime / 60);
            const seconds = Math.floor(this.audio.currentTime % 60);
            this.currentTimeEl.textContent = 
                `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        }
    }

    switchSection(section) {
        // Mostrar sección correspondiente (sin navegación de botones)
        document.querySelectorAll('.section').forEach(sec => {
            sec.style.display = 'none';
        });
        document.getElementById(`${section}-section`).style.display = 'block';
        
        this.contentSections.classList.add('show');
        this.currentSection = section;

        // Auto-ocultar después de 5 segundos si no es home
        if (section !== 'home') {
            setTimeout(() => {
                if (this.currentSection === section) {
                    this.hideContentSections();
                }
            }, 5000);
        }
    }

    hideContentSections() {
        this.contentSections.classList.remove('show');
    }

    addStatusIndicator(status) {
        // Remover indicador anterior
        const existing = document.querySelector('.status-indicator');
        if (existing) existing.remove();

        // Agregar nuevo indicador
        const indicator = document.createElement('div');
        indicator.className = `status-indicator ${status}`;
        document.querySelector('.header').appendChild(indicator);
    }

    // Configurar MediaSession API para controles del sistema
    setupMediaSession() {
        if ('mediaSession' in navigator) {
            navigator.mediaSession.setActionHandler('play', () => this.play());
            navigator.mediaSession.setActionHandler('pause', () => this.pause());
            navigator.mediaSession.setActionHandler('stop', () => this.pause());
        }
    }

    // Cuando empieza la reproducción
    onPlay() {
        this.startMetadataPolling();
        this.updateMediaSession();
    }

    // Cuando se pausa la reproducción
    onPause() {
        this.stopMetadataPolling();
    }

    // Iniciar polling de metadatos
    startMetadataPolling() {
        // Detener polling anterior si existe
        this.stopMetadataPolling();
        
        // Obtener metadatos inmediatamente
        this.fetchMetadata();
        
        // Configurar polling cada 10 segundos
        this.metadataInterval = setInterval(() => {
            this.fetchMetadata();
        }, 10000);
    }

    // Detener polling de metadatos
    stopMetadataPolling() {
        if (this.metadataInterval) {
            clearInterval(this.metadataInterval);
            this.metadataInterval = null;
        }
    }

    // Obtener metadatos del stream
    async fetchMetadata() {
        try {
            const url = this.audio.src;
            if (!url) return;

            // Intentar diferentes métodos para obtener metadatos
            await this.tryIcecastMetadata(url);
            
        } catch (error) {
            console.log('Error obteniendo metadatos:', error);
            // Fallback a información básica
            this.updateMetadata({
                title: 'Transmisión en Vivo',
                artist: 'Radio Zeno FM'
            });
        }
    }

    // Intentar obtener metadatos de Icecast/Shoutcast
    async tryIcecastMetadata(streamUrl) {
        try {
            // Construir URL de metadatos de Icecast
            const url = new URL(streamUrl);
            const metadataUrl = `${url.origin}${url.pathname}/7.html`;
            
            // Usar proxy CORS si es necesario
            const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(metadataUrl)}`;
            
            const response = await fetch(proxyUrl);
            const data = await response.json();
            
            if (data.contents) {
                const metadata = this.parseIcecastMetadata(data.contents);
                if (metadata.title || metadata.artist) {
                    this.updateMetadata(metadata);
                    return;
                }
            }
        } catch (error) {
            console.log('Error con metadatos Icecast:', error);
        }
        
        // Intentar método alternativo
        await this.tryStreamMetadata();
    }

    // Método alternativo para obtener metadatos
    async tryStreamMetadata() {
        try {
            const url = this.audio.src;
            
            // Intentar con diferentes APIs de metadatos
            const apiUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
            
            fetch(apiUrl)
                .then(response => response.json())
                .then(data => {
                    // Buscar metadatos en headers
                    if (data.status && data.status.headers) {
                        this.parseStreamHeaders(data.status.headers);
                    }
                })
                .catch(() => {
                    // Usar información simulada basada en timestamp
                    this.generateSimulatedMetadata();
                });
                
        } catch (error) {
            console.log('Error obteniendo metadatos del stream:', error);
            this.generateSimulatedMetadata();
        }
    }

    // Parsear metadatos de Icecast
    parseIcecastMetadata(content) {
        const metadata = {};
        
        try {
            // Icecast devuelve información en formato simple
            const cleanContent = content.replace(/<[^>]*>/g, '').trim();
            
            if (cleanContent.includes(' - ')) {
                const parts = cleanContent.split(' - ');
                metadata.artist = parts[0].trim();
                metadata.title = parts[1].trim();
            } else {
                metadata.title = cleanContent;
                metadata.artist = 'Radio Zeno FM';
            }
        } catch (error) {
            console.log('Error parseando metadatos:', error);
        }
        
        return metadata;
    }

    // Parsear headers del stream
    parseStreamHeaders(headers) {
        const metadata = {};
        
        if (headers['icy-name']) {
            metadata.artist = headers['icy-name'];
        }
        
        if (headers['icy-title']) {
            metadata.title = headers['icy-title'];
        }
        
        if (metadata.title || metadata.artist) {
            this.updateMetadata(metadata);
        }
    }

    // Generar metadatos simulados (con canciones cristianas en español)
    generateSimulatedMetadata() {
        const songs = [
            { artist: 'Marcos Witt', title: 'Cuán Bello Es El Señor' },
            { artist: 'Marco Barrientos', title: 'Hosanna' },
            { artist: 'Jesús Adrián Romero', title: 'Mi Universo' },
            { artist: 'Alex Campos', title: 'El Sonido del Silencio' },
            { artist: 'Miel San Marcos', title: 'Danzando' },
            { artist: 'Un Corazón', title: 'Jesucristo Basta' },
            { artist: 'Christine D\'Clario', title: 'Como Dijiste' },
            { artist: 'Danilo Montero', title: 'Alabaré' },
            { artist: 'Marcela Gándara', title: 'Supe Que Me Amabas' },
            { artist: 'Rojo', title: 'Jardin de Rosas' },
            { artist: 'Tercer Cielo', title: 'Yo Te Extrañaré' },
            { artist: 'Redimi2', title: 'Filipenses 1:6' },
            { artist: 'Evan Craft', title: 'Seas Exaltado' },
            { artist: 'Julissa', title: 'Venid Fieles Todos' },
            { artist: 'Abel Zavala', title: 'Eres Rey' },
            { artist: 'Torre Fuerte', title: 'Ven y Llena Esta Casa' },
            { artist: 'En Espíritu Y En Verdad', title: 'Como El Ciervo' },
            { artist: 'Generación 12', title: 'Vuelvo a Casa' },
            { artist: 'Lilly Goodman', title: 'Al Final' },
            { artist: 'Samuel Hernández', title: 'Levanto Mis Manos' },
            { artist: 'Ingrid Rosario', title: 'Majestuoso' },
            { artist: 'Coalo Zamorano', title: 'Tu Nombre Santo Es' },
            { artist: 'Roberto Orellana', title: 'Mi Dios Es Real' },
            { artist: 'Nancy Amancio', title: 'El Poder de Tu Amor' },
            { artist: 'Barak', title: 'Shekinah' },
            { artist: 'Averly Morillo', title: 'Lo Que Nunca Fue' },
            { artist: 'Funky', title: 'Te Luciste' },
            { artist: 'Kike Pavón', title: 'Que Se Abra El Cielo' },
            { artist: 'Su Presencia', title: 'Será Llena La Tierra' },
            { artist: 'Twice', title: 'Será Llena La Tierra' },
            { artist: 'Juan Carlos Alvarado', title: 'El Varón de Dolores' },
            { artist: 'Jaime Murrell', title: 'Yo Quiero Más de Ti' },
            { artist: 'Edgar Lira', title: 'Celestial' },
            { artist: 'Lid', title: 'En Tu Luz' },
            { artist: 'Paulo César Baruk', title: 'Quão Grande És Tu' }
        ];
        
        // Elegir una canción aleatoria diferente a la actual
        let randomSong;
        do {
            randomSong = songs[Math.floor(Math.random() * songs.length)];
        } while (randomSong.title === this.currentMetadata.title);
        
        this.updateMetadata(randomSong);
    }

    // Actualizar metadatos y UI
    updateMetadata(metadata) {
        // Verificar si es información nueva
        const isNewSong = (metadata.title && metadata.title !== this.currentMetadata.title) ||
                         (metadata.artist && metadata.artist !== this.currentMetadata.artist);
        
        // Actualizar metadatos internos
        if (metadata.title) this.currentMetadata.title = metadata.title;
        if (metadata.artist) this.currentMetadata.artist = metadata.artist;
        if (metadata.album) this.currentMetadata.album = metadata.album;
        if (metadata.artwork) this.currentMetadata.artwork = metadata.artwork;
        
        // Si es una canción nueva, agregar al historial
        if (isNewSong && this.currentMetadata.title !== 'Conectando...' && 
            this.currentMetadata.title !== 'Transmisión en Vivo') {
            this.addToHistory({
                title: this.currentMetadata.title,
                artist: this.currentMetadata.artist,
                time: new Date().toLocaleTimeString(),
                timestamp: Date.now()
            });
        }
        
        // Actualizar UI
        this.updateUIWithMetadata();
        this.updateMediaSession();
        
        this.lastMetadataUpdate = Date.now();
        console.log('Metadatos actualizados:', this.currentMetadata);
    }

    // Agregar canción al historial
    addToHistory(song) {
        // Evitar duplicados recientes (menos de 30 segundos)
        const isDuplicate = this.songHistory.some(item => 
            item.title === song.title && 
            item.artist === song.artist && 
            (song.timestamp - item.timestamp) < 30000
        );
        
        if (!isDuplicate) {
            this.songHistory.unshift(song); // Agregar al inicio
            
            // Mantener solo las últimas 20 canciones
            if (this.songHistory.length > 20) {
                this.songHistory = this.songHistory.slice(0, 20);
            }
            
            this.updateHistoryUI();
            this.saveHistoryToLocalStorage();
        }
    }

    // Actualizar interfaz del historial
    updateHistoryUI() {
        const historyContainer = document.getElementById('songHistory');
        if (!historyContainer) return;

        if (this.songHistory.length === 0) {
            historyContainer.innerHTML = '<p style="color: #999; text-align: center; padding: 20px;">El historial aparecerá aquí cuando se reproduzcan canciones</p>';
            return;
        }

        const historyHTML = this.songHistory.map(song => `
            <div class="history-item">
                <div class="song-details">
                    <div class="song-title">${song.title}</div>
                    <div class="song-artist">${song.artist}</div>
                </div>
                <div class="song-time">${song.time}</div>
            </div>
        `).join('');

        historyContainer.innerHTML = historyHTML;
    }

    // Guardar historial en localStorage
    saveHistoryToLocalStorage() {
        try {
            localStorage.setItem('radioPlayerHistory', JSON.stringify(this.songHistory));
        } catch (error) {
            console.log('Error guardando historial:', error);
        }
    }

    // Cargar historial desde localStorage
    loadHistoryFromLocalStorage() {
        try {
            const saved = localStorage.getItem('radioPlayerHistory');
            if (saved) {
                this.songHistory = JSON.parse(saved);
                this.updateHistoryUI();
            }
        } catch (error) {
            console.log('Error cargando historial:', error);
            this.songHistory = [];
        }
    }

    // Actualizar interfaz con metadatos
    updateUIWithMetadata() {
        // Mostrar indicador de actualización
        if (this.metadataIndicator) {
            this.metadataIndicator.classList.add('updating');
            setTimeout(() => {
                this.metadataIndicator.classList.remove('updating');
            }, 2000);
        }
        
        // Actualizar texto principal
        this.artistNameEl.textContent = this.currentMetadata.artist;
        this.songTitleEl.textContent = this.currentMetadata.title;
        
        // Formatear texto del mini reproductor
        const miniText = this.currentMetadata.title !== this.currentMetadata.artist 
            ? `${this.currentMetadata.artist} - ${this.currentMetadata.title}`
            : this.currentMetadata.artist;
        this.miniTitleEl.textContent = miniText;
        
        // Actualizar artwork si está disponible
        if (this.currentMetadata.artwork) {
            document.getElementById('albumImage').src = this.currentMetadata.artwork;
            document.querySelector('.mini-album img').src = this.currentMetadata.artwork;
        }
        
        // Animación suave al cambiar
        this.songTitleEl.style.opacity = '0';
        setTimeout(() => {
            this.songTitleEl.style.opacity = '1';
        }, 200);
    }

    // Actualizar MediaSession para controles del sistema
    updateMediaSession() {
        if ('mediaSession' in navigator) {
            navigator.mediaSession.metadata = new MediaMetadata({
                title: this.currentMetadata.title,
                artist: this.currentMetadata.artist,
                album: this.currentMetadata.album || 'Radio Stream',
                artwork: this.currentMetadata.artwork ? [
                    { src: this.currentMetadata.artwork, sizes: '512x512', type: 'image/jpeg' }
                ] : [
                    { src: 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=512&h=512&fit=crop&crop=center', sizes: '512x512', type: 'image/jpeg' }
                ]
            });
        }
    }

    // Método para cargar streams predefinidos
    loadStream(url) {
        this.streamUrlInput.value = url;
        this.connectStream();
        this.hideContentSections();
    }
    
    // Métodos para controlar el mini-player
    showMiniPlayer() {
        if (this.miniPlayer) {
            this.miniPlayer.classList.remove('hidden');
        }
        if (this.showMiniPlayerBtn) {
            this.showMiniPlayerBtn.classList.add('hidden');
        }
    }
    
    hideMiniPlayer() {
        if (this.miniPlayer) {
            this.miniPlayer.classList.add('hidden');
        }
        if (this.showMiniPlayerBtn) {
            this.showMiniPlayerBtn.classList.remove('hidden');
        }
    }
    
    // Método para toggle del modo oscuro
    toggleDarkMode() {
        const body = document.body;
        const sleepModeToggle = document.getElementById('sleepModeToggle');
        const sleepModeIcon = sleepModeToggle.querySelector('i');
        const sleepModeText = sleepModeToggle.querySelector('span');
        
        // Toggle dark mode class
        body.classList.toggle('dark-mode');
        sleepModeToggle.classList.toggle('active');
        
        // Cambiar icono y texto según el estado
        if (body.classList.contains('dark-mode')) {
            sleepModeIcon.className = 'fas fa-sun';
            sleepModeText.textContent = 'Light Mode';
            
            // Guardar preferencia en localStorage
            localStorage.setItem('darkMode', 'enabled');
        } else {
            sleepModeIcon.className = 'fas fa-moon';
            sleepModeText.textContent = 'Sleep Mode';
            
            // Guardar preferencia en localStorage
            localStorage.setItem('darkMode', 'disabled');
        }
    }
    
    // Cargar preferencia de modo oscuro al inicializar
    loadDarkModePreference() {
        const darkMode = localStorage.getItem('darkMode');
        const sleepModeToggle = document.getElementById('sleepModeToggle');
        const sleepModeIcon = sleepModeToggle.querySelector('i');
        const sleepModeText = sleepModeToggle.querySelector('span');
        
        if (darkMode === 'enabled') {
            document.body.classList.add('dark-mode');
            sleepModeToggle.classList.add('active');
            sleepModeIcon.className = 'fas fa-sun';
            sleepModeText.textContent = 'Light Mode';
        }
        
        // Cargar volumen guardado
        const savedVolume = localStorage.getItem('radioVolume');
        if (savedVolume !== null) {
            this.currentVolume = parseFloat(savedVolume);
            this.audio.volume = this.currentVolume;
            if (this.volumeSlider) {
                this.volumeSlider.value = this.currentVolume * 100;
            }
            this.updateVolumeDisplay();
            this.updateVolumeIcon();
        }
    }
    
    // Cambiar volumen
    changeVolume(value) {
        const volume = value / 100; // Convertir de 0-100 a 0-1
        this.currentVolume = volume;
        this.audio.volume = volume;
        this.updateVolumeDisplay();
        
        // Guardar volumen en localStorage
        localStorage.setItem('radioVolume', volume.toString());
        
        // Actualizar icono según el volumen
        this.updateVolumeIcon();
    }
    
    // Actualizar display del volumen
    updateVolumeDisplay() {
        const percentage = Math.round(this.currentVolume * 100);
        this.volumePercentage.textContent = `${percentage}%`;
    }
    
    // Actualizar icono del volumen
    updateVolumeIcon() {
        const volume = this.currentVolume;
        let iconClass = 'fas ';
        
        if (volume === 0) {
            iconClass += 'fa-volume-mute';
        } else if (volume < 0.3) {
            iconClass += 'fa-volume-down';
        } else if (volume < 0.7) {
            iconClass += 'fa-volume-up';
        } else {
            iconClass += 'fa-volume-up';
        }
        
        this.volumeIcon.className = iconClass;
    }
    
    // Toggle mute/unmute
    toggleMute() {
        if (this.currentVolume > 0) {
            // Guardar volumen actual y mutear
            this.previousVolume = this.currentVolume;
            this.changeVolume(0);
            this.volumeSlider.value = 0;
        } else {
            // Restaurar volumen anterior o usar 50% por defecto
            const restoreVolume = this.previousVolume || 0.5;
            this.changeVolume(restoreVolume * 100);
            this.volumeSlider.value = restoreVolume * 100;
        }
    }
    
    // AutoPlay: Iniciar reproducción automáticamente
    startAutoPlay() {
        // Pequeño delay para asegurar que el stream esté completamente listo
        setTimeout(() => {
            if (this.isConnected && !this.isPlaying) {
                this.audio.play()
                    .then(() => {
                        console.log('AutoPlay iniciado exitosamente');
                        this.songTitleEl.textContent = 'Reproduciendo en Vivo';
                        this.addStatusIndicator('autoplay');
                        
                        // Remover indicador de autoplay después de 3 segundos
                        setTimeout(() => {
                            this.addStatusIndicator('connected');
                        }, 3000);
                    })
                    .catch(error => {
                        console.log('AutoPlay bloqueado por el navegador:', error);
                        // Fallback: Mostrar mensaje para que el usuario inicie manualmente
                        this.songTitleEl.textContent = 'Toca para Reproducir (AutoPlay Bloqueado)';
                        
                        // Agregar event listener temporal para iniciar con la primera interacción
                        const startOnInteraction = () => {
                            if (!this.isPlaying && this.isConnected) {
                                this.play();
                            }
                            // Remover listeners después del primer uso
                            document.removeEventListener('click', startOnInteraction);
                            document.removeEventListener('touchstart', startOnInteraction);
                        };
                        
                        document.addEventListener('click', startOnInteraction, { once: true });
                        document.addEventListener('touchstart', startOnInteraction, { once: true });
                    });
            }
        }, 500); // 500ms de delay
    }
    
    // ===== SISTEMA DE RECONEXIÓN AUTOMÁTICA =====
    
    // Detectar interrupciones del stream
    onStreamInterrupted(eventType) {
        console.log(`Stream interrumpido: ${eventType}`);
        
        if (this.isConnected && this.lastStreamUrl && !this.isReconnecting) {
            // Solo iniciar reconexión si el stream estaba funcionando
            setTimeout(() => {
                if (!this.isConnected && !this.isReconnecting) {
                    this.startReconnection(eventType);
                }
            }, 2000); // Esperar 2 segundos antes de reconectar
        }
    }
    
    // Detectar cuando el stream está esperando datos
    onStreamWaiting() {
        console.log('Stream esperando datos...');
        
        if (this.isConnected) {
            this.songTitleEl.textContent = 'Buffering...';
            
            // Si toma demasiado tiempo, considerar reconexión
            setTimeout(() => {
                if (this.songTitleEl.textContent === 'Buffering...' && !this.isReconnecting) {
                    this.startReconnection('buffering_timeout');
                }
            }, 10000); // 10 segundos de timeout
        }
    }
    
    // Iniciar proceso de reconexión
    startReconnection(reason) {
        if (this.isReconnecting || this.reconnectAttempts >= this.maxReconnectAttempts) {
            if (this.reconnectAttempts >= this.maxReconnectAttempts) {
                this.onReconnectFailed();
            }
            return;
        }
        
        this.isReconnecting = true;
        this.reconnectAttempts++;
        
        console.log(`Iniciando reconexión (intento ${this.reconnectAttempts}/${this.maxReconnectAttempts}) por: ${reason}`);
        
        // Mostrar estado de reconexión
        this.songTitleEl.textContent = `Reconectando... (${this.reconnectAttempts}/${this.maxReconnectAttempts})`;
        this.addStatusIndicator('reconnecting');
        
        // Calcular delay con backoff exponencial
        const currentDelay = Math.min(
            this.reconnectDelay * Math.pow(this.reconnectBackoff, this.reconnectAttempts - 1),
            this.maxReconnectDelay
        );
        
        console.log(`Próximo intento en ${currentDelay}ms`);
        
        this.reconnectTimeout = setTimeout(() => {
            this.attemptReconnect();
        }, currentDelay);
    }
    
    // Intentar reconectar
    attemptReconnect() {
        if (!this.lastStreamUrl) {
            this.onReconnectFailed();
            return;
        }
        
        console.log(`Ejecutando intento de reconexión ${this.reconnectAttempts}`);
        
        // Limpiar el stream actual
        this.audio.src = '';
        this.audio.load();
        
        // Pequeño delay antes de cargar el nuevo stream
        setTimeout(() => {
            this.audio.src = this.lastStreamUrl;
            this.audio.load();
            
            // Timeout para este intento
            const attemptTimeout = setTimeout(() => {
                if (this.isReconnecting && !this.isConnected) {
                    console.log('Timeout en intento de reconexión');
                    this.startReconnection('attempt_timeout');
                }
            }, 15000); // 15 segundos por intento
            
            // Limpiar timeout si la conexión es exitosa
            const onSuccess = () => {
                clearTimeout(attemptTimeout);
                this.audio.removeEventListener('canplay', onSuccess);
            };
            
            this.audio.addEventListener('canplay', onSuccess, { once: true });
            
        }, 1000);
    }
    
    // Resetear estado de reconexión cuando la conexión es exitosa
    resetReconnectState() {
        this.reconnectAttempts = 0;
        this.isReconnecting = false;
        this.cancelReconnect();
        console.log('Estado de reconexión reseteado - Conexión exitosa');
    }
    
    // Cancelar reconexión en curso
    cancelReconnect() {
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }
    }
    
    // Manejar fallo total de reconexión
    onReconnectFailed() {
        this.isReconnecting = false;
        this.isConnected = false;
        this.cancelReconnect();
        
        console.log('Reconexión fallida - Se agotaron los intentos');
        
        this.songTitleEl.textContent = `Error: No se pudo reconectar (${this.reconnectAttempts} intentos)`;
        this.connectBtn.textContent = 'Reconectar Manualmente';
        this.connectBtn.disabled = false;
        this.addStatusIndicator('error');
        this.hideMiniPlayer();
        
        // Resetear para permitir reconexión manual
        setTimeout(() => {
            this.reconnectAttempts = 0;
        }, 30000); // Resetear después de 30 segundos
    }
    
    // Forzar reconexión manual
    forceReconnect() {
        console.log('Reconexión forzada por el usuario');
        
        // Cancelar cualquier reconexión automática en curso
        this.cancelReconnect();
        
        // Resetear contadores
        this.reconnectAttempts = 0;
        this.isReconnecting = false;
        
        // Si hay una URL guardada, usarla; sino, usar la del input
        const urlToUse = this.lastStreamUrl || this.streamUrlInput.value.trim();
        
        if (!urlToUse) {
            alert('No hay URL de stream para reconectar');
            return;
        }
        
        // Actualizar la URL del input si es necesaria
        if (this.lastStreamUrl && this.lastStreamUrl !== this.streamUrlInput.value) {
            this.streamUrlInput.value = this.lastStreamUrl;
        }
        
        // Ejecutar reconexión
        this.connectStream();
    }
}

// Función global para cargar streams
function loadStream(url) {
    if (window.radioPlayer) {
        window.radioPlayer.loadStream(url);
    }
}

// Inicializar el reproductor cuando se carga la página
document.addEventListener('DOMContentLoaded', () => {
    window.radioPlayer = new RadioPlayer();
    
    // Auto-conectar el stream de radio después de 1 segundo
    setTimeout(() => {
        window.radioPlayer.connectStream();
    }, 1000);
    
    // URLs de ejemplo para testing
    const exampleStreams = [
        'https://stream.zeno.fm/yg7bvksbfwzuv',
        'https://live.powerapp.com.tr/powerturk/mpeg/icecast.audio',
        'https://22283.live.streamtheworld.com/RADIO_DISNEYAAC.aac'
    ];
    
    // Agregar streams de ejemplo a la playlist
    const playlistContainer = document.querySelector('.playlist-items');
    exampleStreams.forEach((url, index) => {
        const item = document.createElement('div');
        item.className = 'playlist-item';
        item.innerHTML = `
            <span>Radio Stream ${index + 1}</span>
            <button onclick="loadStream('${url}')">Reproducir</button>
        `;
        playlistContainer.appendChild(item);
    });
});

// Service Worker para mejorar la experiencia offline
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .then(registration => {
                console.log('SW registrado:', registration);
            })
            .catch(registrationError => {
                console.log('SW falló:', registrationError);
            });
    });
}