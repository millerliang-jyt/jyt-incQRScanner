new Vue({
	el: '#app',
	data() {
		let savedConfig = {}
		let savedLogs = []
		try {
			savedConfig = JSON.parse(localStorage.getItem('jyt_config') || '{}')
			savedLogs = JSON.parse(localStorage.getItem('jyt_logs') || '[]')
		} catch (e) {}
		return {
			config: {
				userList: savedConfig.userList || ['管理員', '負責人', '倉管', '採購']
			},
			currentUser: savedConfig.lastUser || '', // 當前使用者
			selectedUser: savedConfig.lastUser || '', // 設定選單的選擇值
			customUser: '', // 自訂輸入的使用者名稱
			newUserInput: '', // 新增使用者的輸入框
			showSettings: !savedConfig.lastUser, // 若無最後使用者則直接顯示設定
			isScanning: false, // 是否正在掃描中
			loading: false, // 是否正在處理掃描結果
			scanCooldown: false, // 掃描防重複冷卻中
			status: '', // success | duplicate | error
			message: '', // 顯示在狀態卡片的訊息
			lastId: '', // 最後掃描的編號
			manualId: '', // 手動輸入的編號
			logs: savedLogs, // 掃描記錄列表
			qrInstance: null // html5-qrcode 實例
		}
	},
	computed: {
		statusColorClass() {
			if (this.status === 'success') return 'text-green-500'
			if (this.status === 'duplicate') return 'text-orange-500'
			if (this.status === 'error') return 'text-red-500'
			return 'text-gray-800'
		},
		statusBadgeClass() {
			if (this.status === 'success') return 'bg-green-50 text-green-600'
			if (this.status === 'duplicate') return 'bg-orange-50 text-orange-500'
			if (this.status === 'error') return 'bg-red-50 text-red-500'
			return 'bg-gray-100 text-gray-500'
		},
		reversedLogs() {
			return [...this.logs].reverse()
		}
	},
	mounted() {
		this.qrInstance = new Html5Qrcode('qrReader', {
			qrbox: {
				// width: 512,
				height: 768
			}
		})
	},
	beforeDestroy() {
		this.stopScan()
	},
	methods: {
		// ── 設定 ──
		addUser() {
			const name = this.newUserInput.trim()
			if (name && !this.config.userList.includes(name)) {
				this.config.userList.push(name)
			}
			this.newUserInput = '' // 清空輸入框
		},
		// 移除使用者
		removeUser(i) {
			this.config.userList.splice(i, 1)
		},
		// 有選人才能關閉
		closeSettings() {
			if (this.currentUser) this.showSettings = false
		},
		// 儲存設定並關閉
		saveSettings() {
			const user = this.selectedUser === '__custom__'
				? this.customUser.trim()
				: this.selectedUser
			if (!user) { alert('請選擇或輸入盤點人員'); return }
			this.currentUser = user
			try {
				localStorage.setItem('jyt_config', JSON.stringify({
					userList: this.config.userList,
					lastUser: user
				}))
			} catch (e) {}
			this.showSettings = false
		},
		// ── 掃描 ──
		async startScan() {
			if (!this.currentUser) { this.showSettings = true; return }
			// ① 檢查是否為 HTTPS / localhost（相機 API 必要條件）
			const isSecure = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1'
			if (!isSecure) {
				this.status = 'error'
				this.message = '需要 HTTPS 才能使用相機'
				this.showCameraError('http')
				return
			}
			// ② 檢查瀏覽器是否支援 getUserMedia
			if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
				this.status = 'error'
				this.message = '此瀏覽器不支援相機'
				this.showCameraError('unsupported')
				return
			}
			// ③ 先用原生 API 預先請求權限，取得更精確的錯誤訊息
			try {
				const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
				// 取得成功後立刻釋放，交給 html5-qrcode 接管
				stream.getTracks().forEach(t => t.stop())
			} catch (permErr) {
				this.status = 'error'
				const name = permErr.name || ''
				if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
					this.message = '相機權限被拒絕'
					this.showCameraError('denied')
				} else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
					this.message = '找不到相機裝置'
					this.showCameraError('notfound')
				} else if (name === 'NotReadableError' || name === 'TrackStartError') {
					this.message = '相機被其他程式佔用'
					this.showCameraError('busy')
				} else {
					this.message = '相機存取失敗：' + name
					this.showCameraError('unknown', permErr.message)
				}
				return
			}
			// ④ 啟動 html5-qrcode
			this.message = '正在喚醒相機...'
			this.qrInstance.start(
				{ facingMode: 'environment' },
				{ fps: 10, qrbox: 250 },
				(text) => { this.handleResult(text) }
			).then(() => {
				this.isScanning = true
				this.status = ''
				this.message = '對準 QR Code...'
			}).catch(err => {
				this.status = 'error'
				this.message = '相機啟動失敗'
				this.showCameraError('unknown', err.toString())
			})
		},
		// ── 相機錯誤處理 ──
		showCameraError(type, detail) {
			const msgs = {
				http: `⚠️ 相機需要 HTTPS 環境\n\n目前網址：${location.href}\n\n解決方法：\n• 部署到 GitHub Pages（自動提供 HTTPS）\n• 或使用 https:// 網址開啟`,
				unsupported: `⚠️ 瀏覽器不支援相機\n\n建議改用：\n• iPhone → Safari\n• Android → Chrome\n\n請勿使用 LINE、FB 等 App 內建瀏覽器`,
				denied: `⚠️ 相機權限被拒絕\n\n解決方法：\n• iPhone：設定 → Safari → 相機 → 允許\n• Android：設定 → 應用程式 → Chrome → 權限 → 相機\n• 或點網址列左側鎖頭圖示 → 相機 → 允許\n\n允許後請重新整理頁面`,
				notfound: `⚠️ 找不到相機裝置\n\n請確認：\n• 裝置有內建相機\n• 相機未被停用`,
				busy: `⚠️ 相機被其他程式佔用\n\n請：\n• 關閉其他使用相機的 App 或分頁\n• 重新整理後再試`,
				unknown: `⚠️ 相機啟動失敗\n\n錯誤詳情：${detail || '未知錯誤'}\n\n請截圖此訊息並回報`
			}
			alert(msgs[type] || msgs.unknown)
		},
		// 停止掃描並釋放相機
		stopScan() {
			if (this.isScanning && this.qrInstance) {
				this.qrInstance.stop().catch(() => {}).finally(() => {
					this.isScanning = false
					this.message = '準備就緒'
				})
			}
		},
		// ── 手動輸入處理 ──
		handleManualInput() {
			const val = this.manualId.trim()
			if (!val || this.loading) return
			this.handleResult(val)
			this.manualId = ''
		},
		// ── 核心邏輯（對齊原 GAS processInventory 行為）──
		handleResult(assetId) {
			if (this.loading || this.scanCooldown) return
			// 2 秒防重複冷卻
			this.scanCooldown = true
			setTimeout(() => { this.scanCooldown = false }, 2000)
			// 本地重複檢查（同日同編號）
			const today = new Date().toLocaleDateString('zh-TW')
			const isDuplicate = this.logs.some(l =>
				l.assetId === assetId &&
				l.status === 'success' &&
				String(l.time || '').startsWith(today)
			)
			if (isDuplicate) {
				this.lastId = assetId
				this.status = 'duplicate'
				this.message = '今日已盤點過'
				this.pushLog(assetId, 'duplicate')
				this.resetAfter(2000)
				return
			}
			this.loading = true
			this.lastId = assetId
			this.status = 'success'
			this.message = '已記錄'
			this.pushLog(assetId, 'success')
			this.loading = false
			this.resetAfter(1800)
		},
		pushLog(assetId, status) {
			const time = new Date().toLocaleString('zh-TW', { hour12: false })
			this.logs.push({ assetId, status, inspector: this.currentUser, time })
			try {
				localStorage.setItem('jyt_logs', JSON.stringify(this.logs.slice(-300)))
			} catch (e) {}
		},
		// 清除所有記錄
		clearLogs() {
			if (confirm('確定清除所有記錄？')) {
				this.logs = []
				try { localStorage.removeItem('jyt_logs') } catch (e) {}
			}
		},
		// 掃描結果狀態重置
		resetAfter(ms) {
			setTimeout(() => {
				this.status = ''
				this.message = this.isScanning ? '對準下一個 QR Code' : '準備就緒'
			}, ms)
		}
	}
})