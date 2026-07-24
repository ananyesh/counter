import os
import sys
import threading
import requests
from io import BytesIO
from PIL import Image
import customtkinter as ctk
import yt_dlp
import imageio_ffmpeg
from tkinter import messagebox

# Set appearance and color theme
ctk.set_appearance_mode("Dark")
ctk.set_default_color_theme("blue")

class SonicFlowApp(ctk.CTk):
    def __init__(self):
        super().__init__()

        self.title("SonicFlow - High Quality YouTube MP3")
        self.geometry("650x550")
        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(0, weight=1)

        # Main Container
        self.main_frame = ctk.CTkFrame(self, corner_radius=20, fg_color="#0a0a0a")
        self.main_frame.grid(row=0, column=0, sticky="nsew", padx=20, pady=20)
        self.main_frame.grid_columnconfigure(0, weight=1)

        # Header
        self.header_label = ctk.CTkLabel(
            self.main_frame, 
            text="SonicFlow", 
            font=ctk.CTkFont(family="Outfit", size=42, weight="bold"),
            text_color="#ff0050"
        )
        self.header_label.grid(row=0, column=0, pady=(40, 5))

        self.subtitle_label = ctk.CTkLabel(
            self.main_frame, 
            text="Premium MP3 Extraction Engine", 
            font=ctk.CTkFont(family="Outfit", size=14),
            text_color="#a0a0a0"
        )
        self.subtitle_label.grid(row=1, column=0, pady=(0, 30))

        # Input Area
        self.url_entry = ctk.CTkEntry(
            self.main_frame, 
            placeholder_text="Paste YouTube or YouTube Music link here...",
            width=500,
            height=50,
            corner_radius=12,
            border_color="#1a1a1a",
            fg_color="#141414",
            font=ctk.CTkFont(size=14)
        )
        self.url_entry.grid(row=2, column=0, padx=40, pady=10)
        self.url_entry.bind("<KeyRelease>", self.on_url_change)

        # Metadata Preview Frame (hidden initially)
        self.preview_frame = ctk.CTkFrame(self.main_frame, fg_color="transparent")
        self.preview_frame.grid(row=3, column=0, pady=20, padx=40, sticky="ew")
        self.preview_frame.grid_columnconfigure(1, weight=1)

        self.thumb_label = ctk.CTkLabel(self.preview_frame, text="", width=120, height=90)
        self.thumb_label.grid(row=0, column=0, padx=(0, 15))

        self.info_frame = ctk.CTkFrame(self.preview_frame, fg_color="transparent")
        self.info_frame.grid(row=0, column=1, sticky="w")

        self.title_label = ctk.CTkLabel(
            self.info_frame, text="", font=ctk.CTkFont(weight="bold", size=14), 
            wraplength=350, justify="left", anchor="w"
        )
        self.title_label.pack(fill="x")

        self.uploader_label = ctk.CTkLabel(
            self.info_frame, text="", font=ctk.CTkFont(size=12), text_color="#a0a0a0", anchor="w"
        )
        self.uploader_label.pack(fill="x")

        # Progress Bar (hidden)
        self.progress_bar = ctk.CTkProgressBar(self.main_frame, width=500, height=8, corner_radius=10, fg_color="#141414", progress_color="#ff0050")
        self.progress_bar.grid(row=4, column=0, pady=10)
        self.progress_bar.set(0)
        self.progress_bar.grid_remove()

        # Download Button
        self.download_button = ctk.CTkButton(
            self.main_frame, 
            text="Download Best Quality MP3", 
            command=self.start_download_thread,
            width=500,
            height=55,
            corner_radius=12,
            fg_color="#ff0050",
            hover_color="#ff1a66",
            font=ctk.CTkFont(size=16, weight="bold"),
            state="disabled"
        )
        self.download_button.grid(row=5, column=0, pady=(20, 40))

        # Status Message
        self.status_label = ctk.CTkLabel(
            self.main_frame, text="", font=ctk.CTkFont(size=12), text_color="#a0a0a0"
        )
        self.status_label.grid(row=6, column=0, pady=(0, 20))

        # State variables
        self.current_info = None
        self.fetching_info = False

    def on_url_change(self, event=None):
        url = self.url_entry.get().strip()
        if (url.startswith("http") and ("youtube.com" in url or "youtu.be" in url)) and not self.fetching_info:
            threading.Thread(target=self.fetch_metadata, args=(url,), daemon=True).start()

    def fetch_metadata(self, url):
        self.fetching_info = True
        try:
            ydl_opts = {'quiet': True, 'no_warnings': True}
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=False)
                self.current_info = info
                
                # Update UI
                self.title_label.configure(text=info.get('title', 'Unknown Title'))
                self.uploader_label.configure(text=f"{info.get('uploader', 'Unknown')} • {info.get('duration_string', '')}")
                
                # Fetch thumbnail
                thumb_url = info.get('thumbnail')
                if thumb_url:
                    response = requests.get(thumb_url)
                    img_data = response.content
                    img = Image.open(BytesIO(img_data))
                    img = img.resize((120, 90), Image.Resampling.LANCZOS)
                    ctk_img = ctk.CTkImage(light_image=img, dark_image=img, size=(120, 90))
                    self.thumb_label.configure(image=ctk_img)

                self.download_button.configure(state="normal")
        except Exception as e:
            print(f"Metadata error: {e}")
            self.download_button.configure(state="disabled")
        finally:
            self.fetching_info = False

    def progress_hook(self, d):
        if d['status'] == 'downloading':
            p = d.get('_percent_str', '0%').replace('%','')
            try:
                self.progress_bar.set(float(p)/100)
                self.status_label.configure(text=f"Downloading... {p}%")
            except: pass
        elif d['status'] == 'finished':
            self.status_label.configure(text="Processing audio... (Converting to MP3)")

    def start_download_thread(self):
        url = self.url_entry.get().strip()
        if not url: return
        
        self.download_button.configure(state="disabled", text="Processing...")
        self.progress_bar.grid()
        self.progress_bar.set(0)
        
        threading.Thread(target=self.download_mp3, args=(url,), daemon=True).start()

    def download_mp3(self, url):
        try:
            ffmpeg_path = imageio_ffmpeg.get_ffmpeg_exe()
            output_path = os.path.join(os.path.expanduser("~/Downloads"), '%(title)s.%(ext)s')
            
            ydl_opts = {
                'format': 'bestaudio/best',
                'postprocessors': [{
                    'key': 'FFmpegExtractAudio',
                    'preferredcodec': 'mp3',
                    'preferredquality': '0', # 0 is best VBR
                }],
                'ffmpeg_location': ffmpeg_path,
                'outtmpl': output_path,
                'progress_hooks': [self.progress_hook],
                'quiet': True,
                'no_warnings': True,
            }

            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                ydl.download([url])

            self.status_label.configure(text="Success! MP3 saved to your Downloads folder.", text_color="#4ade80")
            messagebox.showinfo("Success", "Download complete! Your high-quality MP3 is in the Downloads folder.")
        except Exception as e:
            self.status_label.configure(text=f"Error: {str(e)}", text_color="#ff4d4d")
            messagebox.showerror("Error", f"Failed to download: {str(e)}")
        finally:
            self.download_button.configure(state="normal", text="Download Best Quality MP3")
            self.progress_bar.grid_remove()

if __name__ == "__main__":
    app = SonicFlowApp()
    app.mainloop()
